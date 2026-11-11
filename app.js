import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, orderBy, limit, onSnapshot }
  from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import { firebaseConfig, AI_MODEL, AI_DAILY_LIMIT } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let model = null;
try {
  model = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }),
    { model: AI_MODEL, generationConfig: { responseMimeType: "application/json" } });
} catch (e) { model = null; }

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STAMPS = ["がんばった", "わかる", "すごい", "応援してる", "ナイス過程"];
const COLORS = ["#e2557a", "#3f6fb0", "#3f9a7a", "#c07a2c", "#7a6fd6", "#b0487f", "#4d8fa8", "#8a7d3a"];
const S = {
  tab: "home", status: "loading", uid: null, isAdmin: false,
  posts: [], stamps: {}, members: {}, pilot: null, memory: [], reports: [],
  draft: { show: "", behind: "", vis: "lock", usedAgent: false, usedExamples: false, memo: null },
  chat: null, ex: null, confirmDel: null, editName: false, joinErr: ""
};
const subs = [];

/* ---------- 起動・参加 ---------- */
onAuthStateChanged(auth, async user => {
  if (!user) { signInAnonymously(auth).catch(() => { S.status = "error"; render(); }); return; }
  S.uid = user.uid;
  try {
    const m = await getDoc(doc(db, "members", S.uid));
    if (m.exists()) start(); else { S.status = "join"; render(); }
  } catch (e) { S.status = "join"; render(); }
});

async function join(code, nick) {
  S.joinErr = "";
  if (!code || !nick) { S.joinErr = "招待コードとニックネームを入力してください"; return render(); }
  try { await setDoc(doc(db, "joins", S.uid), { code }); }
  catch (e) { if (!String(e.code).includes("permission")) { S.joinErr = "通信できませんでした。もう一度お試しください"; return render(); } }
  try { await setDoc(doc(db, "members", S.uid), { nick: nick.slice(0, 20), joinedAt: Date.now() }); start(); }
  catch (e) { S.joinErr = "招待コードが違います"; render(); }
}

async function start() {
  S.status = "ready"; $("#tabs").hidden = false; go("home");
  subs.push(onSnapshot(query(collection(db, "posts"), orderBy("at", "desc"), limit(500)),
    s => { S.posts = s.docs.map(d => ({ id: d.id, ...d.data() })); rerender(); }, () => { S.status = "error"; render(); }));
  subs.push(onSnapshot(collection(db, "stamps"), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.stamps = m; rerender(); }));
  subs.push(onSnapshot(collection(db, "members"), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.members = m; rerender(); }));
  subs.push(onSnapshot(doc(db, "config", "pilot"), d => { S.pilot = d.exists() ? d.data() : null; rerender(); }, () => {}));
  getDoc(doc(db, "memory", S.uid)).then(d => { S.memory = d.exists() && Array.isArray(d.data().items) ? d.data().items : []; }).catch(() => {});
  try { S.isAdmin = (await getDoc(doc(db, "admins", S.uid))).exists(); } catch (e) { S.isAdmin = false; }
  if (S.isAdmin) subs.push(onSnapshot(query(collection(db, "reports"), orderBy("at", "desc")),
    s => { S.reports = s.docs.map(d => ({ id: d.id, ...d.data() })); rerender(); }, () => {}));
}
const rerender = () => { if (S.tab !== "post") render(); };
const nm = id => (S.members[id] && S.members[id].nick) || (id === S.uid ? "あなた" : "参加者");
const color = id => { let h = 0; for (const c of id || "") h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };

/* ---------- 期間 ---------- */
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
function pilotState() { const p = S.pilot; if (!p || !p.start || !p.end) return "open"; const t = today(); return t < p.start ? "before" : t > p.end ? "after" : "open"; }
function pilotBanner() {
  const p = S.pilot, st = pilotState(); if (!p || !p.start) return "";
  if (st === "before") return `<div class="banner">試用期間は ${esc(p.start)} からです。開始まで投稿はできません。</div>`;
  if (st === "after") return `<div class="banner">試用期間（${esc(p.start)}〜${esc(p.end)}）は終了しました。ご協力ありがとうございました。</div>`;
  return `<div class="banner">試用期間：${esc(p.start)} 〜 ${esc(p.end)}</div>`;
}

/* ---------- 表示 ---------- */
let toastT;
function toast(t) { const o = document.querySelector(".toast"); if (o) o.remove(); const d = document.createElement("div"); d.className = "toast"; d.textContent = t; $(".phone").appendChild(d); clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 2600); }
function go(t) {
  S.tab = t; document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === t));
  $("#topSub").textContent = { home: "みんなの投稿", post: "新規投稿", agent: "相談", me: "マイページ" }[t]; render(); $("#screen").scrollTop = 0;
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => go(b.dataset.tab));
function ago(ms) { const m = Math.floor((Date.now() - ms) / 60000); if (m < 1) return "たった今"; if (m < 60) return m + "分前"; const h = Math.floor(m / 60); if (h < 24) return h + "時間前"; return Math.floor(h / 24) + "日前"; }
const mine = () => S.posts.filter(p => p.uid === S.uid);
const unlocked = () => mine().length > 0;
const myKinds = pid => (S.stamps[pid + "_" + S.uid] || {}).kinds || [];
function receivedKinds(pid) { const s = new Set(); Object.values(S.stamps).forEach(v => { if (v.postId === pid && v.uid !== S.uid) (v.kinds || []).forEach(k => s.add(k)); }); return [...s]; }

function postHTML(p) {
  const own = p.uid === S.uid, pressed = myKinds(p.id);
  const behind = p.vis === "lock" && !unlocked() && !own
    ? `<div class="part locked"><div class="blur">${esc(p.behind)}</div><div class="msg"><span>鍵ありBEHIND</span><span class="hint">自分もBEHINDを投稿すると見られます</span><button data-act="toPost">BEHINDを書く</button></div></div>`
    : `<div class="part behind"><span class="lb">BEHIND${p.vis === "lock" ? "・鍵あり" : ""}</span><div>${esc(p.behind)}</div></div>`;
  const canDel = own || S.isAdmin;
  const tools = S.confirmDel === p.id
    ? `<div class="confirm"><span class="hint">削除しますか？</span><button style="background:var(--accent);color:#fff" data-del="${esc(p.id)}">削除する</button><button style="background:var(--line)" data-act="cancelDel">やめる</button></div>`
    : `<span>${canDel ? `<button class="mini" data-askdel="${esc(p.id)}">削除</button>` : ""}${own ? "" : `<button class="mini" data-report="${esc(p.id)}">通報</button>`}</span>`;
  const kinds = own ? receivedKinds(p.id) : [];
  return `<article class="post"><div class="row"><div class="who"><div class="av" style="background:${color(p.uid)}">${esc(nm(p.uid)[0])}</div><div><b>${esc(nm(p.uid))}</b><small>${ago(p.at)}</small></div></div>${tools}</div>
  <div class="part show"><span class="lb">SHOW</span><div>${esc(p.show)}</div></div>${behind}
  ${own ? `<div class="got">${kinds.length ? "届いた気持ち：" + kinds.map(esc).join("・") : "まだスタンプは届いていません"}</div>`
        : `<div class="stamps">${STAMPS.map(s => `<button data-pid="${esc(p.id)}" data-s="${s}" aria-pressed="${pressed.includes(s)}">${s}</button>`).join("")}</div>`}
  </article>`;
}

const R = {
  home() {
    return pilotBanner() + (S.posts.length ? S.posts.map(postHTML).join("")
      : `<div class="empty"><b>まだ投稿はありません</b><span>最初のSHOWとBEHINDを投稿してみましょう。</span><button class="btn main" style="width:auto" data-act="toPost">投稿する</button></div>`);
  },
  post() {
    if (pilotState() !== "open") return pilotBanner();
    const d = S.draft;
    return `
  <label class="f" for="show">SHOW（結果・完成した姿）</label>
  <textarea id="show" rows="2" maxlength="200" placeholder="例：資格試験に合格した！">${esc(d.show)}</textarea><div class="cnt"><span id="c1">${d.show.length}</span>/200</div>
  <button class="btn sub" data-act="consult" ${d.show.trim() ? "" : "disabled"}>${botIcon()}エージェントに相談してBEHINDを考える</button>
  <label class="f" for="behind">BEHIND（過程・努力・本音）</label>
  <textarea id="behind" rows="5" maxlength="500" placeholder="${d.memo ? esc("メモ：" + d.memo.join(" / ")) : "そこに至るまでの過程を書こう（努力・失敗・準備・本音など）"}">${esc(d.behind)}</textarea><div class="cnt"><span id="c2">${d.behind.length}</span>/500</div>
  <button class="btn sub" data-act="examples" ${d.show.trim() && S.ex !== "loading" ? "" : "disabled"}>${S.ex === "loading" ? "例を考えています…" : "BEHINDの例を見る"}</button>
  ${Array.isArray(S.ex) ? `<div class="exs">${S.ex.map((e, i) => `<div class="ex"><span class="lb">例${i + 1}</span><div>${esc(e)}</div><button data-ex="${i}">入力欄にコピーして書きかえる</button></div>`).join("")}<p class="hint">例はあくまで参考です。自分の言葉に書きかえて投稿しよう。</p></div>` : ""}
  <div style="font-size:12px;font-weight:900;margin-top:12px">公開範囲</div>
  <div class="vis">
   <label><input type="radio" name="vis" value="open" ${d.vis === "open" ? "checked" : ""}><span>オープン投稿<small>参加者全員が見られます</small></span></label>
   <label><input type="radio" name="vis" value="lock" ${d.vis === "lock" ? "checked" : ""}><span>鍵あり投稿<small>自分もBEHINDを投稿した人だけが見られます</small></span></label>
  </div>
  <p class="hint">本名・学校名・住所など、個人が特定される内容は書かないでください。</p>
  <button class="btn main" data-act="submit" ${d.show.trim() && d.behind.trim() ? "" : "disabled"}>投稿する</button>`;
  },
  agent() {
    const head = `<div class="agent-head"><div class="bot">${botSVG()}</div><div><b>${esc(nm(S.uid))}のエージェント</b><div class="hint">${S.chat ? "SHOW：" + esc(S.chat.show) : "あなたの過程を一緒に言葉にします"}</div></div></div>`;
    if (!S.chat) return head + `<div class="chat"><div class="msg-a">投稿画面でSHOWを書いて「相談」を押すと、BEHINDを書くための質問をします。\n\n文章を代わりに書くことはしません。答えるのも、投稿するのも、あなたです。</div></div><p><button class="btn main" data-act="toPost">投稿画面へ</button></p>`;
    const c = S.chat; let h = head + `<div class="chat">`; c.log.forEach(m => h += `<div class="${m.a ? "msg-a" : "msg-u"}">${esc(m.t)}</div>`); h += "</div>";
    if (c.stage === "pick") h += `<div class="chips" style="margin-top:10px">${c.qs.map((q, i) => `<button data-q="${i}">${esc(q)}</button>`).join("")}</div>`;
    else if (c.stage === "answer") h += `<div class="inrow"><input type="text" id="ans" placeholder="思い出しながら答えてみよう" aria-label="答え"><button data-act="send">送信</button></div>`;
    else if (c.stage === "done") h += `<div class="memo" style="margin-top:10px"><b>あなたの答えのメモ</b><ul>${c.answers.map(a => `<li>${esc(a)}</li>`).join("")}</ul><button class="btn main" data-act="useMemo">このメモを見ながらBEHINDを書く</button></div>`;
    return h;
  },
  me() {
    const my = mine();
    let h = `<div class="who" style="margin-bottom:12px"><div class="av" style="background:${color(S.uid)}">${esc(nm(S.uid)[0])}</div><div style="flex:1;min-width:0"><b>${esc(nm(S.uid))}</b><small>投稿 ${my.length}件</small></div><button class="mini" data-act="editName">名前を変更</button></div>
  ${S.editName ? `<div class="inrow" style="margin:-4px 0 6px"><input type="text" id="nick" maxlength="20" value="${esc((S.members[S.uid] || {}).nick || "")}" aria-label="ニックネーム"><button data-act="saveName">保存</button></div><p class="hint" style="margin:0 0 12px">本名は避けて、ニックネームにしましょう（20文字まで）。</p>` : ""}
  <div class="mem"><h3>エージェントが覚えていること</h3>${S.memory.length ? `<ul style="margin:0;padding-left:1.2em">${S.memory.map(m => `<li>${esc(m)}</li>`).join("")}</ul>` : `<p class="hint" style="margin:0">まだ記憶はありません。投稿すると、過程の要点を覚えていきます。</p>`}
  ${S.memory.length ? `<button class="mini" data-act="clearMem" style="margin-top:6px">記憶をすべて消す</button>` : ""}<p class="hint" style="margin:6px 0 0">この記憶はあなたにしか見えません。</p></div>
  <div class="tl"><h3>わたしの過程の振り返り</h3><p class="hint" style="margin:0 0 10px">他の人とではなく、過去の自分と比べられます。</p>
  ${my.length ? `<ol>${my.map(x => `<li><time>${new Date(x.at).toLocaleDateString("ja-JP")}</time><div><b>${esc(x.show)}</b></div><div style="font-size:13px;white-space:pre-wrap">${esc(x.behind)}</div></li>`).join("")}</ol>` : `<p class="hint">まだ投稿がありません。</p>`}</div>
  <p class="hint" style="margin-top:16px">ユーザーID：${esc(S.uid)}<br>※ブラウザのデータを消したり別の端末で開いたりすると、別の参加者として扱われます。</p>`;
    if (S.isAdmin) h += adminPanel();
    return h;
  }
};
function adminPanel() {
  const ps = S.posts, n = ps.length, pct = x => n ? Math.round(x / n * 100) + "%" : "—";
  const people = new Set(ps.map(p => p.uid)).size, joined = Object.keys(S.members).length;
  let stamps = 0; Object.values(S.stamps).forEach(v => stamps += (v.kinds || []).length);
  const days = new Set(ps.map(p => new Date(p.at).toDateString())).size, p = S.pilot || {};
  const reps = S.reports.map(r => { const post = ps.find(x => x.id === r.postId); return `<div class="rep">${new Date(r.at).toLocaleString("ja-JP")}　通報者：${esc(nm(r.uid))}<br>${post ? `投稿者：${esc(nm(post.uid))}／SHOW：${esc(post.show)}<br><button class="mini" data-askdel="${esc(post.id)}" data-tohome="1">投稿を確認して削除</button>` : "（投稿は削除済み）"} <button class="mini" data-rdone="${esc(r.id)}">対応済みにする</button></div>`; }).join("");
  return `<div class="owner"><h3>運営用（運営者にだけ表示）</h3>
  <div class="dates"><label>開始日<input type="date" id="pStart" value="${esc(p.start || "")}"></label><label>終了日<input type="date" id="pEnd" value="${esc(p.end || "")}"></label><button data-act="savePilot">期間を保存</button></div>
  <p class="hint">期間外は投稿できなくなります。閲覧はいつでもできます。</p>
  <div class="stats">
   <div class="stat"><b>${joined}</b><span>参加者</span></div><div class="stat"><b>${people}</b><span>投稿した人</span></div>
   <div class="stat"><b>${n}</b><span>投稿数</span></div><div class="stat"><b>${days}</b><span>投稿があった日数</span></div>
   <div class="stat"><b>${pct(ps.filter(x => x.usedAgent).length)}</b><span>エージェントに相談した投稿</span></div>
   <div class="stat"><b>${pct(ps.filter(x => x.usedExamples).length)}</b><span>BEHINDの例を見た投稿</span></div>
   <div class="stat"><b>${pct(ps.filter(x => x.vis === "lock").length)}</b><span>鍵ありで投稿</span></div><div class="stat"><b>${stamps}</b><span>スタンプの合計</span></div>
  </div>
  <h4>通報（${S.reports.length}件）</h4>${reps || `<p class="hint">通報はありません。</p>`}</div>`;
}
function botSVG() { return `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><rect x="5" y="8" width="14" height="11" rx="4"/><path d="M12 4v4M9.5 13h.01M14.5 13h.01M10 16h4"/></svg>`; }
function botIcon() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="8" width="14" height="11" rx="4"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>`; }
function joinHTML() {
  return `<div class="join"><h2>ようこそ</h2><p class="hint" style="font-size:13px;margin:0 0 8px">運営から伝えられた招待コードと、使いたいニックネームを入力してください。</p><p class="hint" style="margin:0 0 8px">※18歳以上の方のみ参加できます。AI機能への入力内容は、Googleのサービス改善に使われる場合があります。</p>
  <label class="f" for="code">招待コード</label><input type="text" id="code" autocomplete="off">
  <label class="f" for="jnick">ニックネーム（20文字まで）</label><input type="text" id="jnick" maxlength="20" placeholder="本名は避けてください">
  <p class="err">${esc(S.joinErr)}</p><button class="btn main" data-act="join">参加する</button></div>`;
}
function render() {
  const sc = $("#screen");
  if (S.status === "loading") sc.innerHTML = `<div class="empty">読み込んでいます…</div>`;
  else if (S.status === "join") sc.innerHTML = joinHTML();
  else if (S.status === "error") sc.innerHTML = `<div class="empty"><b>読み込めませんでした</b><span>通信状況を確認して、ページを開き直してください。</span></div>`;
  else sc.innerHTML = R[S.tab]();
  bind();
}

/* ---------- AI（Firebase AI Logic / Gemini） ---------- */
const RULES = `あなたはSNSアプリ『motto!』で、利用者一人ひとりについている専用のAIエージェントです。役割は、投稿の「BEHIND（結果に至るまでの過程・努力・失敗・本音）」を本人が書けるよう、聞き役として質問することです。\n厳守：投稿文を代わりに書かない／評価や比較（すごい・もっと頑張れ等）をしない／質問は短く、やさしい日本語で／個人情報を聞かない。`;
const memText = () => S.memory.length ? "エージェントの記憶（この人の過去の過程）：\n- " + S.memory.join("\n- ") : "エージェントの記憶：まだなし";
function aiAllowed() {
  try { const k = "motto-ai-" + today(), n = +(localStorage.getItem(k) || 0); if (n >= AI_DAILY_LIMIT) return false; localStorage.setItem(k, n + 1); } catch (e) {}
  return true;
}
async function aiJSON(prompt) {
  if (!model || !aiAllowed()) return null;
  try { const r = await model.generateContent(prompt); return JSON.parse(r.response.text()); } catch (e) { console.warn("AI", e); return null; }
}
function questionsFor(show) {
  if (/点|テスト|試験|検定|資格|合格/.test(show)) return { open: "勉強の結果ですね。そこに至るまでを振り返ってみましょう。", qs: ["一番頑張ったことは？", "前回と比べて、何を変えた？", "途中でくじけそうになったことは？"], follow: ["それはいつ、どんな場面でしたか？", "そのとき、支えになったものはありますか？"] };
  if (/試合|大会|部活|勝|記録|練習|ライブ|発表/.test(show)) return { open: "今回の結果につながったことを振り返ってみましょう。", qs: ["毎日の練習で続けたことは？", "うまくいかなかった時期はあった？", "一緒に頑張った人はいる？"], follow: ["そのとき、どんな気持ちでしたか？", "次に向けて、何を続けたいですか？"] };
  return { open: "そこに至るまでの過程を、一緒に思い出してみましょう。", qs: ["一番時間をかけたことは？", "途中で大変だったことは？", "支えてくれた人はいる？"], follow: ["そのとき、どう乗り越えましたか？", "やってみて、気持ちはどう変わりましたか？"] };
}
async function aiOpen(show) {
  const v = await aiJSON(RULES + "\n\n" + memText() + "\n\n今回のSHOW（結果）：「" + show + "」\n\n記憶に関係があれば一言触れた短い声かけ(open)と、BEHINDを引き出す質問を3つ(qs)、JSONで返してください。形式：{\"open\":\"...\",\"qs\":[\"...\",\"...\",\"...\"]}");
  return v && typeof v.open === "string" && Array.isArray(v.qs) && v.qs.length ? { open: v.open, qs: v.qs.slice(0, 3).map(String) } : null;
}
async function aiFollow(c) {
  if (!c.ai) return null;
  const conv = c.log.map(m => (m.a ? "エージェント：" : "本人：") + m.t).join("\n");
  const v = await aiJSON(RULES + "\n\n" + memText() + "\n\nSHOW：「" + c.show + "」\nここまでの会話：\n" + conv + "\n\n本人の最後の答えを短く受け止め、さらに過程を深掘りする質問を1つだけ返してください。形式：{\"reply\":\"...\"}");
  return v && typeof v.reply === "string" ? v.reply : null;
}
async function aiExamples(show, memo) {
  const v = await aiJSON("SNSアプリ『motto!』で、利用者がBEHIND（結果に至るまでの過程・努力・失敗・本音）を書くときの参考例を作ります。\nSHOW（結果）：「" + show + "」\n" + (memo && memo.length ? "本人が答えたメモ：" + memo.join(" / ") + "\nメモの内容を活かしてください。\n" : "") + "自然な口語で、80〜150字の例を2つ、書き方を変えて（1つは努力の過程中心、1つは失敗や本音中心）作ってください。事実を誇張せず、メモにない具体的な数字は作らないこと。形式：{\"examples\":[\"...\",\"...\"]}");
  if (v && Array.isArray(v.examples) && v.examples.length) return v.examples.slice(0, 2).map(String);
  return ["最初はうまくいかなくて、何度もやり直した。毎日少しずつでも続けることだけは決めていた。途中で投げ出したくなったけど、友達に話を聞いてもらって持ち直せた。",
    "正直、前回は全然ダメで悔しかった。やり方を変えてみたら少しずつ手ごたえが出てきて、今回やっと形になった。まだ課題もあるけど、ここまで来られたのはうれしい。"];
}
async function updateMemory(show, behind) {
  const v = await aiJSON("次の投稿から、この人の努力や悩みの要点を、あとで振り返りの質問に使えるよう30字以内の1文で要約してください。個人情報は含めないこと。\nSHOW：「" + show + "」\nBEHIND：「" + behind + "」\n形式：{\"memory\":\"...\"}");
  const line = (v && typeof v.memory === "string" ? v.memory : "「" + show.slice(0, 20) + "」の過程を振り返った") + "（" + new Date().toLocaleDateString("ja-JP") + "）";
  S.memory = [line, ...S.memory].slice(0, 10);
  setDoc(doc(db, "memory", S.uid), { items: S.memory }).catch(() => {});
}

/* ---------- 操作 ---------- */
function bind() {
  const sc = $("#screen");
  sc.querySelectorAll("[data-s]").forEach(b => b.onclick = () => {
    const pid = b.dataset.pid, s = b.dataset.s, cur = new Set(myKinds(pid)); cur.has(s) ? cur.delete(s) : cur.add(s);
    const id = pid + "_" + S.uid, kinds = [...cur]; S.stamps = { ...S.stamps, [id]: { postId: pid, uid: S.uid, kinds } }; b.setAttribute("aria-pressed", cur.has(s));
    (kinds.length ? setDoc(doc(db, "stamps", id), { postId: pid, uid: S.uid, kinds }) : deleteDoc(doc(db, "stamps", id))).catch(() => toast("スタンプを保存できませんでした"));
  });
  sc.querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act));
  sc.querySelectorAll("[data-askdel]").forEach(b => b.onclick = () => { S.confirmDel = b.dataset.askdel; if (b.dataset.tohome) go("home"); else render(); });
  sc.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { const id = b.dataset.del; S.confirmDel = null; deleteDoc(doc(db, "posts", id)).then(() => toast("削除しました")).catch(() => toast("削除できませんでした")); });
  sc.querySelectorAll("[data-report]").forEach(b => b.onclick = () => addDoc(collection(db, "reports"), { uid: S.uid, postId: b.dataset.report, at: Date.now() }).then(() => toast("運営に通報しました")).catch(() => toast("通報を送れませんでした")));
  sc.querySelectorAll("[data-rdone]").forEach(b => b.onclick = () => deleteDoc(doc(db, "reports", b.dataset.rdone)).catch(() => toast("更新できませんでした")));
  sc.querySelectorAll("[data-ex]").forEach(b => b.onclick = () => { S.draft.behind = S.ex[b.dataset.ex]; S.draft.usedExamples = true; S.ex = null; render(); const t = $("#behind"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); toast("自分の言葉に書きかえてみよう"); });
  sc.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { const c = S.chat, q = c.qs[b.dataset.q]; c.log.push({ a: 0, t: q }); c.log.push({ a: 1, t: q.replace(/？$/, "") + "について、教えてください。" }); c.stage = "answer"; render(); focusAns(); });
  const sh = $("#show"), bh = $("#behind");
  if (sh) {
    sh.oninput = () => { S.draft.show = sh.value; $("#c1").textContent = sh.value.length; upd(); };
    bh.oninput = () => { S.draft.behind = bh.value; $("#c2").textContent = bh.value.length; upd(); };
    sc.querySelectorAll("input[name=vis]").forEach(r => r.onchange = () => S.draft.vis = r.value);
  }
  const an = $("#ans"); if (an) an.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); act("send"); } };
}
function upd() { const d = S.draft; $('[data-act="consult"]').disabled = !d.show.trim(); const ex = $('[data-act="examples"]'); if (ex) ex.disabled = !d.show.trim() || S.ex === "loading"; $('[data-act="submit"]').disabled = !(d.show.trim() && d.behind.trim()); }
function focusAns() { const a = $("#ans"); if (a) a.focus(); }
function act(a) {
  if (a === "join") return join(($("#code").value || "").trim(), ($("#jnick").value || "").trim());
  if (a === "toPost") return go("post");
  if (a === "cancelDel") { S.confirmDel = null; return render(); }
  if (a === "editName") { S.editName = !S.editName; render(); const n = $("#nick"); if (n) n.focus(); return; }
  if (a === "saveName") {
    const v = ($("#nick").value || "").trim().slice(0, 20); if (!v) return toast("ニックネームを入力してください");
    S.editName = false; updateDoc(doc(db, "members", S.uid), { nick: v }).then(() => toast("名前を変更しました")).catch(() => toast("名前を保存できませんでした")); return render();
  }
  if (a === "examples") { const show = S.draft.show; S.ex = "loading"; render(); aiExamples(show, S.draft.memo).then(r => { S.ex = r; if (S.tab === "post") render(); }); return; }
  if (a === "consult") {
    const show = S.draft.show, q = questionsFor(show); S.draft.usedAgent = true;
    S.chat = { show, qs: [], follow: q.follow, step: 0, answers: [], stage: "wait", ai: false, log: [{ a: 1, t: "考えています…" }] }; go("agent");
    aiOpen(show).then(r => { const c = S.chat; if (!c || c.show !== show) return; const use = r || q; c.ai = !!r; c.qs = use.qs; c.stage = "pick"; c.log = [{ a: 1, t: use.open + "\n下から答えやすい質問を選んでください。" }]; if (S.tab === "agent") render(); });
    return;
  }
  if (a === "send") {
    const v = ($("#ans").value || "").trim(); if (!v) return; const c = S.chat; c.log.push({ a: 0, t: v }); c.answers.push(v);
    if (c.step < c.follow.length) {
      c.stage = "wait"; c.log.push({ a: 1, t: "考えています…" }); render();
      aiFollow({ ...c, log: c.log.slice(0, -1) }).then(r => { c.log.pop(); c.log.push({ a: 1, t: r || c.follow[c.step] }); c.step++; c.stage = "answer"; if (S.tab === "agent") { render(); focusAns(); } });
    } else { c.log.push({ a: 1, t: "ありがとうございます。今の答えをメモにしました。\nこのメモを見ながら、自分の言葉でBEHINDを書いてみてください。" }); c.stage = "done"; render(); }
    return;
  }
  if (a === "useMemo") { S.draft.memo = S.chat.answers; go("post"); const bh = $("#behind"); if (bh) bh.focus(); toast("メモを入力欄に表示しました"); return; }
  if (a === "clearMem") { S.memory = []; setDoc(doc(db, "memory", S.uid), { items: [] }).then(() => toast("記憶を消しました")).catch(() => toast("消せませんでした")); return render(); }
  if (a === "savePilot") {
    const s = $("#pStart").value, e = $("#pEnd").value; if (!s || !e || s > e) return toast("開始日と終了日を正しく入れてください");
    setDoc(doc(db, "config", "pilot"), { start: s, end: e }).then(() => toast("試用期間を保存しました")).catch(() => toast("保存できませんでした")); return;
  }
  if (a === "submit") {
    if (pilotState() !== "open") return toast("試用期間外のため投稿できません");
    const d = S.draft, item = { uid: S.uid, show: d.show.trim(), behind: d.behind.trim(), vis: d.vis, at: Date.now(), usedAgent: !!d.usedAgent, usedExamples: !!d.usedExamples };
    S.draft = { show: "", behind: "", vis: "lock", usedAgent: false, usedExamples: false, memo: null }; S.chat = null; S.ex = null; go("home");
    addDoc(collection(db, "posts"), item).then(() => toast("投稿しました")).catch(() => toast("投稿できませんでした。もう一度お試しください"));
    updateMemory(item.show, item.behind);
  }
}
render();
