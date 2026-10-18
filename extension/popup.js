document.getElementById("go").addEventListener("click", () => {
  const ca = document.getElementById("ca").value.trim();
  if (!/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(ca)) return;
  chrome.tabs.create({ url: `https://crawlhive.xyz/scan/${ca}` });
});
