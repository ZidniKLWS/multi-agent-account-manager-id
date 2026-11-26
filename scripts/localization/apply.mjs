// Localization overlay for upstream Multi-Agent Account Manager.
// Applies a small, maintainable translation layer without modifying upstream logic.
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.cwd(), "src", "main.ts");
let source = fs.readFileSync(file, "utf8");

const helperAnchor = "function render(): void {";
const railAnchor = '          <div class="rail-footer">';

if (!source.includes(helperAnchor)) throw new Error("Localization patch: render anchor not found");
if (!source.includes(railAnchor)) throw new Error("Localization patch: rail-footer anchor not found");
if (source.includes("MAAM_LOCALIZATION_OVERLAY")) {
  console.log("Localization overlay already applied.");
  process.exit(0);
}

const helper = `// MAAM_LOCALIZATION_OVERLAY
const MAAM_LANG_KEY = "maam_ui_language";
type MaamLanguage = "en" | "id" | "zh";
let maamLanguage: MaamLanguage = (() => {
  try { const v = localStorage.getItem(MAAM_LANG_KEY); return v === "id" || v === "zh" || v === "en" ? v : "en"; }
  catch { return "en"; }
})();
const MAAM_TRANSLATIONS: Record<string, Record<string, string>> = {
  "zh": {},
  "id": {
    "群聊":"Obrolan Grup","同步":"Sinkronisasi","设置":"Pengaturan","更新":"Pembaruan","新版本":"Versi Baru",
    "待接入":"Segera Hadir","检查更新":"Periksa Pembaruan","托盘常驻与全局快捷键设置":"Pengaturan tray dan shortcut global",
    "跨设备多端加密同步":"Sinkronisasi terenkripsi antar perangkat","多账号群聊（桌面端）":"Obrolan multi-akun (desktop)",
    "发送":"Kirim","发送中…":"Mengirim…","添加账号":"Tambah Akun","添加":"Tambah","取消":"Batal",
    "保存":"Simpan","删除":"Hapus","重命名":"Ubah Nama","账号":"Akun","代理":"Proxy","时区":"Zona Waktu",
    "跟随系统":"Ikuti Sistem","纽约":"New York","洛杉矶":"Los Angeles","伦敦":"London","东京":"Tokyo",
    "新加坡":"Singapura","上海":"Shanghai","UTC":"UTC","深色":"Gelap","浅色":"Terang","跟随":"Ikuti",
    "外观主题":"Tema Tampilan","主题":"Tema","常规":"Umum","确认":"Konfirmasi","关闭":"Tutup",
    "导入":"Impor","导出":"Ekspor","刷新":"Refresh","正在加载…":"Memuat…","加载失败":"Gagal memuat",
    "已登录":"Sudah login","未登录":"Belum login","登录":"Login","账号管理":"Manajemen Akun",
    "语言":"Bahasa","English":"English","Bahasa Indonesia":"Bahasa Indonesia","简体中文":"简 Chinese"
  },
  "en": {
    "群聊":"Group Chat","同步":"Sync","设置":"Settings","更新":"Update","新版本":"New Version",
    "待接入":"Coming Soon","检查更新":"Check for Updates","托盘常驻与全局快捷键设置":"Tray and global shortcut settings",
    "跨设备多端加密同步":"Encrypted cross-device sync","多账号群聊（桌面端）":"Multi-account group chat (desktop)",
    "发送":"Send","发送中…":"Sending…","添加账号":"Add Account","添加":"Add","取消":"Cancel",
    "保存":"Save","删除":"Delete","重命名":"Rename","账号":"Accounts","代理":"Proxy","时区":"Timezone",
    "跟随系统":"System","纽约":"New York","洛杉矶":"Los Angeles","伦敦":"London","东京":"Tokyo",
    "新加坡":"Singapore","上海":"Shanghai","UTC":"UTC","深色":"Dark","浅色":"Light","跟随":"System",
    "外观主题":"Appearance","主题":"Theme","常规":"General","确认":"Confirm","关闭":"Close",
    "导入":"Import","导出":"Export","刷新":"Refresh","正在加载…":"Loading…","加载失败":"Failed to load",
    "已登录":"Signed in","未登录":"Signed out","登录":"Sign in","账号管理":"Account Manager"
  }
};
function maamTranslateText(text: string): string {
  const dict = MAAM_TRANSLATIONS[maamLanguage] || {};
  return dict[text] ?? text;
}
function applyMaamLocalization(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const original = node.textContent || "";
    const trimmed = original.trim();
    if (!trimmed) continue;
    const translated = maamTranslateText(trimmed);
    if (translated !== trimmed) node.textContent = original.replace(trimmed, translated);
  }
  root.querySelectorAll<HTMLElement>("input,textarea,button,[title],[aria-label]").forEach(el => {
    for (const attr of ["placeholder","title","aria-label"]) {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, maamTranslateText(value));
    }
  });
  const selector = root.querySelector<HTMLSelectElement>("#maam-language-selector");
  if (selector) selector.value = maamLanguage;
}
function maamLanguageSelectorHtml(): string {
  return `<div class="rail-language-control" style="padding:8px 6px;"><select id="maam-language-selector" aria-label="Language" style="width:100%;padding:7px;border-radius:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);"><option value="en">English</option><option value="id">Bahasa Indonesia</option><option value="zh">简体中文</option></select></div>`;
}
function bindMaamLanguageSelector(): void {
  const select = document.querySelector<HTMLSelectElement>("#maam-language-selector");
  if (!select) return;
  select.value = maamLanguage;
  select.onchange = () => {
    maamLanguage = select.value as MaamLanguage;
    try { localStorage.setItem(MAAM_LANG_KEY, maamLanguage); } catch {}
    render();
  };
}
// End MAAM_LOCALIZATION_OVERLAY
`;

source = source.replace(helperAnchor, helper + "\\n" + helperAnchor);
source = source.replace(railAnchor, railAnchor + "\\n" + "          ${maamLanguageSelectorHtml()}");
const renderEndAnchor = "  if (!root || !snapshot) return;";
if (!source.includes(renderEndAnchor)) throw new Error("Localization patch: render root guard not found");
// Inject localization and selector binding after root rendering, before event binding is not required;
// run after render's HTML assignment by calling on the next microtask from the render function body.
source = source.replace(renderEndAnchor, renderEndAnchor + "\\n  // MAAM localization is applied after each render.\\n  ");
const renderCloseAnchor = "  const provider = currentProvider(snapshot);";
source = source.replace(renderCloseAnchor, renderCloseAnchor + "\\n  ");
const finalAnchor = "  root.innerHTML = `";
if (!source.includes(finalAnchor)) throw new Error("Localization patch: render template anchor not found");
source = source.replace(/(root.innerHTML = \`[\\s\\S]*?\`;)\\n/g, "$1\\n    applyMaamLocalization();\\n    bindMaamLanguageSelector();\\n");
fs.writeFileSync(file, source);
console.log("Localization overlay patched into src/main.ts");
