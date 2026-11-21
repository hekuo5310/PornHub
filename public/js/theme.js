(() => {
  const key = 'panel-theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  let preference;
  let select;
  try { preference = localStorage.getItem(key); } catch { /* Storage may be disabled. */ }

  function applyTheme() {
    const theme = preference === 'dark' || preference === 'light'
      ? preference
      : (systemTheme.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    if (select) select.value = preference === 'dark' || preference === 'light' ? preference : 'system';
  }

  applyTheme();
  systemTheme.addEventListener('change', applyTheme);
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = event.newValue;
    applyTheme();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const control = document.createElement('label');
    control.className = 'theme-control';
    control.textContent = '主题';
    select = document.createElement('select');
    for (const [value, label] of [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']]) {
      select.add(new Option(label, value));
    }
    select.addEventListener('change', () => {
      preference = select.value;
      try { localStorage.setItem(key, preference); } catch { /* Keep the current page usable. */ }
      applyTheme();
    });
    control.append(select);
    document.body.append(control);
    applyTheme();
  });
})();
