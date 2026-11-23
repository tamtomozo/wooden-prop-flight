import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * ビルドした JS と CSS を index.html に埋め込み、1ファイルにする。
 * ブラウザは file:// から別ファイルの JS モジュールを読み込めないため、
 * こうしておくと dist/index.html をダブルクリックするだけで遊べる。
 */
function inlineIntoHtml(): Plugin {
  return {
    name: "inline-into-html",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.type === "asset" && f.fileName.endsWith(".html"));
      if (!html || html.type !== "asset") return;
      let source = String(html.source);

      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk" && file.isEntry) {
          const tag = new RegExp(`<script type="module" crossorigin src="[^"]*${file.fileName}"></script>`);
          source = source.replace(tag, () => `<script type="module">\n${file.code}</script>`);
          delete bundle[name];
        } else if (file.type === "asset" && file.fileName.endsWith(".css")) {
          const tag = new RegExp(`<link rel="stylesheet" crossorigin href="[^"]*${file.fileName}">`);
          source = source.replace(tag, () => `<style>\n${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = source;
    },
  };
}

/**
 * ランディングページ（lp/）を dist/lp/ にそのままコピーする。
 * タイトル画面の「ゲームの紹介ページ」は ./lp/index.html を開くので、
 * GitHub Pages でも、手元で dist/index.html を開いたときもつながる。
 */
function copyLandingPage(): Plugin {
  let outDir = "dist";
  return {
    name: "copy-landing-page",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      cpSync(resolve(__dirname, "lp"), resolve(outDir, "lp"), { recursive: true });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [inlineIntoHtml(), copyLandingPage()],
});
