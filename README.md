# CFB Power Rankings

Weekly college football power rankings based on who you played and how you played, not on brand name.
Every Monday morning GitHub rebuilds the rankings and updates the website automatically. Your PC doesn't need to be on.

## One-time setup (~15 minutes)

### 1. Get a free data key
1. Go to <https://collegefootballdata.com/key> and enter your email.
2. The key arrives by email. Keep it handy.

### 2. Put the project on GitHub
1. Create a free account at <https://github.com> if you don't have one.
2. Click **+** (top right) → **New repository**. Name it `power-rankings`, set it to **Public**, and **don't** add a README. Click **Create repository**.
3. Tell Claude the repository URL. It will push the code for you (a GitHub sign-in window may pop up once).

### 3. Give GitHub your data key
1. In the repo, go to **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Name: `CFBD_API_KEY`. Secret: paste your key. Click **Add secret**.

### 4. Turn on the website
1. **Settings** → **Pages**.
2. Under "Build and deployment", set Source to **Deploy from a branch**, Branch to **main**, and folder to **/docs**. Click **Save**.
3. Your site will be at `https://<your-username>.github.io/power-rankings/`. Bookmark it.

### 5. Run it the first time
1. Go to the **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
2. Click **Weekly rankings** → **Run workflow** → **Run workflow**.
3. After about a minute, refresh your site.

That's it. From now on it runs every Monday at 9am Eastern (and again Tuesday to pick up stat corrections) from August through January.

## Using the site
- **Sliders** change how much each factor counts. The rankings re-sort instantly, and your settings are remembered on that device.
- **Presets**: *Who'd you beat* (pure résumé), *Who'd win* (predictive), *Hot right now* (recent form).
- **Click a team** to see why it's ranked where it is: its schedule, cupcake games, and luck.
- **Overrated / Underrated** tags mark teams the AP poll ranks 10+ spots differently from the model.
- **Next week's picks** shows the model's pick for every game and its season-long record.
- To share a team, copy the link while its panel is open.

## Tweaking the model
The numbers in `src/config.yaml` are plain-English settings (margin cap, how bad FCS teams are assumed to be, default slider positions). Edit them on GitHub (click the file → pencil icon → **Commit changes**), then press **Run workflow** again.

## Running it on this PC (optional)
```powershell
pip install -r requirements.txt
$env:CFBD_API_KEY = "your-key"
python src/run_weekly.py              # current season
python src/run_weekly.py --season 2025  # any past season
```
Then double-click `preview.bat` to view it in your browser.

## Files
| File | What it does |
|---|---|
| `src/fetch_data.py` | Downloads games, advanced stats, AP poll, talent, returning production |
| `src/model.py` | All ranking math |
| `src/run_weekly.py` | Runs everything and writes `docs/data/` |
| `docs/` | The website |
| `.github/workflows/weekly.yml` | The Monday schedule |
| `tests/make_fake_data.py` | Fake season for testing without a key |
