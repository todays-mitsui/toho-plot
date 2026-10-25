import { defineConfig } from 'vite';

// 相対パスで出力し、GitHub Pagesのサブディレクトリ (/<repo>/) でもbase pathの設定なしで動かす。
// 独自の配置で絶対パスが必要な場合のみ PAGES_BASE_PATH を指定する。
export default defineConfig({
  base: process.env.PAGES_BASE_PATH || './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
