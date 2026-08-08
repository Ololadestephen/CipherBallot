(function () {
  var storageKey = "cipherballot.theme";
  var theme = "dark";

  try {
    var saved = window.localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") {
      theme = saved;
    }
  } catch {
    // Keep the dark fallback when browser storage is unavailable.
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}());
