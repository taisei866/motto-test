// ===== ここを自分のFirebaseプロジェクトの値に書きかえてください =====
// Firebaseコンソール → プロジェクトの設定 → マイアプリ（ウェブ）→「SDK の設定と構成」の firebaseConfig をそのまま貼り付けます。
// ※この値は公開されても問題ない設定値です（データの保護は firestore.rules が行います）。
export const firebaseConfig = {
   apiKey: "AIzaSyCZj-nx0sSddItE1staQ4JyMGlX65t8BD0",
  authDomain: "motto-f628c.firebaseapp.com",
  projectId: "motto-f628c",
  storageBucket: "motto-f628c.firebasestorage.app",
  messagingSenderId: "268701926217",
  appId: "1:268701926217:web:def8d8ef58535a4a5a5098"
};

// 使うAIモデル名（Firebaseコンソールの AI Logic で無料枠で使えるモデルを確認して入れてください）
export const AI_MODEL = "gemini-3.5-flash-lite";

// 1人あたり1日にAIを呼べる回数の上限（無料枠を使い切らないための目安）
export const AI_DAILY_LIMIT = 30;
