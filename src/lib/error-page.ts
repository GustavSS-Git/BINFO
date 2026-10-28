export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <title>Sidan kunde inte laddas</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 16px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; background: #F4F6F9; color: #111418; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 30rem; width: 100%; text-align: left; box-sizing: border-box; background: #fff; border: 1px solid #DCE1E8; border-radius: 10px; padding: 28px; }
      h1 { font: 600 28px/1.15 "Source Serif 4", Georgia, serif; color: #0A2F5E; margin: 0 0 0.75rem; }
      p { color: #30363D; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
      a, button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 22px; border-radius: 6px; font: 600 16px Inter, system-ui, sans-serif; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      a:focus-visible, button:focus-visible { outline: 2px solid #1C4FA3; outline-offset: 2px; }
      .primary { background: #0A2F5E; color: #fff; }
      .secondary { background: #fff; color: #0A2F5E; border-color: #B9C2CE; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Sidan kunde inte laddas</h1>
      <p>Något gick fel hos oss. Prova att ladda om sidan eller gå tillbaka till startsidan.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Försök igen</button>
        <a class="secondary" href="/">Till startsidan</a>
      </div>
    </div>
  </body>
</html>`;
}
