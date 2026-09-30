"""Weekly job: fetch data, rebuild every week of the season, write JSON for the website.

    python src/run_weekly.py                 # current season, fresh data
    python src/run_weekly.py --season 2025   # any past season (backtest)
    python src/run_weekly.py --offline       # reuse cached data, no API calls
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import yaml

import model
from fetch_data import fetch_season

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"


def default_season():
    now = datetime.now()
    return now.year if now.month >= 8 else now.year - 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=default_season())
    ap.add_argument("--offline", action="store_true", help="use cached data only")
    args = ap.parse_args()

    cfg_all = yaml.safe_load((ROOT / "src" / "config.yaml").read_text(encoding="utf-8"))
    cfg = cfg_all["model"]
    season = args.season

    print(f"Season {season}: loading data")
    d = fetch_season(season, refresh=not args.offline)
    prev = fetch_season(season - 1, with_extras=False)

    prev_fbs = model.fbs_teams(prev["teams"])
    prev_games = model.normalize_games(prev["games"], prev_fbs)
    prev_R = model.power_ratings(sorted(prev_fbs), prev_games, cfg)

    fbs = model.fbs_teams(d["teams"])
    games = model.normalize_games(d["games"], fbs)
    prior = model.preseason_prior(sorted(fbs), prev_R, d["talent"], d["returning"])
    lines = model.lines_by_game(d.get("lines", []))
    last = model.last_completed_week(games)
    print(f"  {len(fbs)} FBS teams, {sum(x['done'] for x in games)} completed games, through week {last}")

    out_dir = OUT / str(season)
    out_dir.mkdir(parents=True, exist_ok=True)
    weeks, graded = [], []
    for week in (range(1, last + 1) if last else [0]):
        res = model.build_week(fbs, games, d["advanced"], d["polls"], week, cfg, prior)
        picks = model.predictions(games, res.pop("ratings"), week, cfg, lines)
        graded += [p for p in picks if "actual" in p]
        res.update(season=season, predictions=picks,
                   generated=datetime.now(timezone.utc).isoformat(timespec="minutes"))
        (out_dir / f"week_{week}.json").write_text(json.dumps(res, separators=(",", ":")), encoding="utf-8")
        weeks.append(week)

    def record(key, rows):
        rows = [p for p in rows if p.get(key) is not None]
        return {"games": len(rows), "correct": sum(p[key] for p in rows)}

    su = record("correct", graded)
    with_line = [p for p in graded if "vegas" in p]
    acc = {
        **su,
        "mae": round(sum(p["error"] for p in graded) / len(graded), 1) if graded else None,
        "vegas_su": record("vegas_correct", with_line),       # same games, books' favorite
        "model_su_lined": record("correct", with_line),
        "ats": record("ats_correct", with_line),
        "ats_strong": record("ats_correct", [p for p in with_line if abs(p["edge"]) >= 3]),
        "vegas_mae": round(sum(abs(p["actual"] - p["vegas"]) for p in with_line) / len(with_line), 1) if with_line else None,
    }
    pct = lambda r: f"{r['correct']}/{r['games']} ({r['correct'] / r['games']:.1%})" if r["games"] else "n/a"
    if graded:
        print(f"  model straight up: {pct(su)}, avg miss {acc['mae']} pts")
        print(f"  on games with a line: model {pct(acc['model_su_lined'])} vs books {pct(acc['vegas_su'])}; "
              f"books avg miss {acc['vegas_mae']} pts")
        print(f"  model vs the spread: {pct(acc['ats'])}; edges of 3+ pts: {pct(acc['ats_strong'])}")

    idx_file = OUT / "index.json"
    idx = json.loads(idx_file.read_text(encoding="utf-8")) if idx_file.exists() else {"seasons": {}}
    idx["seasons"][str(season)] = {"weeks": weeks, "accuracy": acc}
    latest = max(idx["seasons"], key=int)
    idx.update(
        latest={"season": int(latest), "week": max(idx["seasons"][latest]["weeks"])},
        factors=[{"key": k, "label": lbl, "help": h} for k, lbl, h in model.FACTORS],
        default_weights=cfg_all["default_weights"],
        updated=datetime.now(timezone.utc).isoformat(timespec="minutes"),
    )
    idx_file.write_text(json.dumps(idx, indent=1), encoding="utf-8")
    print(f"  wrote {len(weeks)} week(s) to {out_dir.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
