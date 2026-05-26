import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider,
  signOut, updateProfile
} from "firebase/auth";
import {
  getFirestore, collection, addDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "firebase/firestore";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const firebaseConfig = {
  apiKey: "AIzaSyDwX7V0zwG-t6M1RlZWEcw6nWWsZn3f8qU",
  authDomain: "finintell-dcf3a.firebaseapp.com",
  projectId: "finintell-dcf3a",
  storageBucket: "finintell-dcf3a.firebasestorage.app",
  messagingSenderId: "278370038069",
  appId: "1:278370038069:web:14711dbaaa2bf28f429c7c"
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

const GROQ_KEY = "finintell_groq_key";
const CATEGORIAS = ["Moradia","Alimentação","Transporte","Saúde","Lazer","Outros","Receita"];
const LIMITES = { Alimentação:1500, Transporte:800, Lazer:600, Saúde:500, Moradia:3000, Outros:300 };
const CORES = ["#4d9fff","#00e5a0","#f5a623","#ff4f6a","#b57bee","#7a8490","#5dcaa5"];
const ICONES = { Moradia:"🏠", Alimentação:"🛒", Transporte:"🚗", Saúde:"💊", Lazer:"🎭", Receita:"💰", Outros:"📦" };

async function callGroq(key, systemPrompt, userMessage) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ]
      })
    });
    if (!res.ok) {
      if (res.status === 401) return "🔑 Chave Groq inválida. Configure em Config.";
      return "⚠️ Erro na API. Tente novamente.";
    }
    const d = await res.json();
    return d.choices?.[0]?.message?.content || "Sem resposta.";
  } catch (e) {
    return "⚠️ Erro de conexão. Verifique sua internet.";
  }
}

const fmt = v => "R$ " + Number(v).toLocaleString("pt-BR");

function calcDados(transacoes) {
  const receita = transacoes.filter(t => t.tipo === "receita").reduce((s, t) => s + Number(t.valor), 0);
  const despesa = transacoes.filter(t => t.tipo === "despesa").reduce((s, t) => s + Number(t.valor), 0);
  const saldo = receita - despesa;
  const poupanca = receita > 0 ? Math.round((saldo / receita) * 100) : 0;
  const porCategoria = CATEGORIAS.filter(c => c !== "Receita").map(cat => ({
    name: cat,
    value: transacoes.filter(t => t.categoria === cat && t.tipo === "despesa").reduce((s, t) => s + Number(t.valor), 0)
  })).filter(c => c.value > 0);
  const porMes = {};
  transacoes.forEach(tx => {
    const mes = tx.data?.slice(3, 10) || "—";
    if (!porMes[mes]) porMes[mes] = { mes, receita: 0, despesa: 0 };
    if (tx.tipo === "receita") porMes[mes].receita += Number(tx.valor);
    else porMes[mes].despesa += Number(tx.valor);
  });
  return { receita, despesa, saldo, poupanca, porCategoria, chartData: Object.values(porMes).slice(-6) };
}

const css = {
  page: { minHeight:"100vh", background:"#080b0e", color:"#e8eaed", fontFamily:"'DM Sans',system-ui,sans-serif" },
  center: { minHeight:"100vh", background:"#080b0e", display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:"'DM Sans',system-ui,sans-serif" },
  card: { background:"#111518", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:36, width:"100%", maxWidth:400 },
  nav: { padding:"0 28px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid rgba(255,255,255,0.06)", background:"rgba(8,11,14,0.92)", backdropFilter:"blur(12px)", position:"sticky", top:0, zIndex:100 },
  main: { padding:"24px 28px", display:"flex", flexDirection:"column", gap:20 },
  grid4: { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 },
  grid2: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 },
  gridDash: { display:"grid", gridTemplateColumns:"1fr 360px", gap:14 },
  kpi: c => ({ background:"#111518", border:"1px solid rgba(255,255,255,0.06)", borderTop:`2px solid ${c}`, borderRadius:12, padding:"18px 20px" }),
  panel: { background:"#111518", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:20 },
  sidebar: { background:"#111518", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, display:"flex", flexDirection:"column", minHeight:520 },
  tab: a => ({ padding:"6px 14px", borderRadius:6, border:"none", cursor:"pointer", fontSize:12, fontWeight:500, background:a?"rgba(0,229,160,0.1)":"transparent", color:a?"#00e5a0":"#7a8490" }),
  btn: { background:"#00e5a0", color:"#080b0e", border:"none", borderRadius:8, padding:"11px 24px", fontSize:13, fontWeight:700, cursor:"pointer", width:"100%" },
  btnGoogle: { width:"100%", background:"transparent", color:"#e8eaed", border:"1px solid rgba(255,255,255,0.12)", borderRadius:8, padding:"11px", fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:16 },
  input: { width:"100%", background:"#181d22", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:"11px 14px", color:"#e8eaed", fontSize:13, outline:"none", boxSizing:"border-box", marginBottom:12 },
  fieldInput: { width:"100%", background:"#181d22", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:"9px 12px", color:"#e8eaed", fontSize:13, outline:"none", boxSizing:"border-box" },
  select: { width:"100%", background:"#181d22", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:"9px 12px", color:"#e8eaed", fontSize:13, outline:"none", boxSizing:"border-box" },
  label: { fontSize:11, color:"#7a8490", fontFamily:"monospace", letterSpacing:"0.06em", display:"block", marginBottom:5 },
  err: { background:"rgba(255,79,106,0.1)", border:"1px solid rgba(255,79,106,0.2)", borderRadius:6, padding:"8px 12px", fontSize:12, color:"#ff4f6a", marginBottom:12 },
  dot: { width:7, height:7, borderRadius:"50%", background:"#00e5a0", boxShadow:"0 0 8px #00e5a0" },
  msgAI: { background:"#181d22", border:"1px solid rgba(255,255,255,0.06)", borderRadius:"4px 10px 10px 10px", padding:"10px 13px", fontSize:13, lineHeight:1.7, whiteSpace:"pre-wrap" },
  msgUser: { background:"rgba(77,159,255,0.1)", border:"1px solid rgba(77,159,255,0.15)", borderRadius:"10px 4px 10px 10px", padding:"10px 13px", fontSize:13, lineHeight:1.6, alignSelf:"flex-end", maxWidth:"85%" },
  msgLabel: { fontFamily:"monospace", fontSize:9, color:"#4a5260", marginBottom:3 },
  chip: { fontSize:10, padding:"3px 10px", borderRadius:20, background:"rgba(0,229,160,0.06)", color:"#00e5a0", border:"1px solid rgba(0,229,160,0.15)", cursor:"pointer", fontFamily:"monospace", whiteSpace:"nowrap" },
};

function AuthPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  const errMsg = code => ({ "auth/email-already-in-use":"Email já cadastrado.", "auth/wrong-password":"Senha incorreta.", "auth/user-not-found":"Usuário não encontrado.", "auth/weak-password":"Senha fraca — mínimo 6 caracteres.", "auth/invalid-credential":"Email ou senha incorretos.", "auth/popup-closed-by-user":"Login cancelado.", "auth/invalid-email":"Email inválido." }[code] || "Erro. Tente novamente.");

  const handleEmail = async () => {
    if (!email || !senha) { setErro("Preencha todos os campos."); return; }
    setLoading(true); setErro("");
    try {
      if (mode === "cadastro") {
        const cred = await createUserWithEmailAndPassword(auth, email, senha);
        if (nome) await updateProfile(cred.user, { displayName: nome });
      } else {
        await signInWithEmailAndPassword(auth, email, senha);
      }
    } catch (e) { setErro(errMsg(e.code)); }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true); setErro("");
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) { setErro(errMsg(e.code)); }
    setLoading(false);
  };

  return (
    <div style={css.center}>
      <div style={css.card}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:28 }}>
          <div style={css.dot}/>
          <span style={{ fontSize:15, fontWeight:800, letterSpacing:"0.08em", color:"#e8eaed" }}>FININTELL</span>
        </div>
        <div style={{ fontSize:22, fontWeight:800, color:"#e8eaed", marginBottom:6, letterSpacing:"-0.02em" }}>
          {mode === "login" ? "Bem-vindo de volta" : "Criar conta"}
        </div>
        <div style={{ fontSize:13, color:"#7a8490", marginBottom:24 }}>
          {mode === "login" ? "Entre para acessar seu dashboard" : "Comece a controlar suas finanças"}
        </div>
        <button style={css.btnGoogle} onClick={handleGoogle} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continuar com Google
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.06)" }}/>
          <span style={{ fontSize:11, color:"#4a5260", fontFamily:"monospace" }}>ou</span>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.06)" }}/>
        </div>
        {erro && <div style={css.err}>{erro}</div>}
        {mode === "cadastro" && <>
          <label style={css.label}>NOME</label>
          <input style={css.input} placeholder="Seu nome" value={nome} onChange={e => setNome(e.target.value)}/>
        </>}
        <label style={css.label}>EMAIL</label>
        <input style={css.input} type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleEmail()}/>
        <label style={css.label}>SENHA</label>
        <input style={{ ...css.input, marginBottom:20 }} type="password" placeholder="••••••••" value={senha} onChange={e => setSenha(e.target.value)} onKeyDown={e => e.key === "Enter" && handleEmail()}/>
        <button style={{ ...css.btn, opacity:loading ? 0.6 : 1 }} onClick={handleEmail} disabled={loading}>
          {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
        <div style={{ fontSize:12, color:"#7a8490", textAlign:"center", marginTop:16 }}>
          {mode === "login" ? "Não tem conta? " : "Já tem conta? "}
          <span style={{ color:"#00e5a0", cursor:"pointer", textDecoration:"underline" }} onClick={() => { setMode(mode === "login" ? "cadastro" : "login"); setErro(""); }}>
            {mode === "login" ? "Cadastre-se" : "Fazer login"}
          </span>
        </div>
      </div>
    </div>
  );
}

function DashboardPage({ transacoes, groqKey }) {
  const { receita, despesa, saldo, poupanca, porCategoria, chartData } = calcDados(transacoes);
  const [msgs, setMsgs] = useState([{
    role: "ai",
    text: "Olá! Sou sua consultora financeira pessoal 💼\n\nEstou analisando seus dados em tempo real. Posso ajudar com planejamento de metas, sugestões de investimento, corte de gastos e muito mais. O que precisa?",
    chips: ["Quero guardar R$30k para um carro", "Como investir meu saldo?", "Onde posso cortar gastos?", "Minha saúde financeira está boa?"]
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatRef = useRef(null);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [msgs]);

  const systemPrompt = `Você é uma consultora financeira pessoal integrada ao app FININTELL. Dados reais do usuário:
- Receita mensal: ${fmt(receita)}
- Despesas mensais: ${fmt(despesa)}
- Saldo disponível: ${fmt(saldo)}
- Taxa de poupança atual: ${poupanca}%
- Gastos por categoria: ${porCategoria.map(c => `${c.name} ${fmt(c.value)}`).join(", ") || "Sem dados ainda"}
- Total de lançamentos: ${transacoes.length}

Você é especialista em:
1. Planejamento financeiro para metas (carro, imóvel, viagem, reserva de emergência)
2. Simulações: "quanto guardar por mês para X em Y meses"
3. Sugestões de investimento para iniciantes (Tesouro Direto, CDB, poupança, fundos)
4. Análise de gastos e onde cortar com base nos dados reais
5. Educação financeira prática

IMPORTANTE: Sempre use os dados reais do usuário nos cálculos. Seja direta, prática e use números reais. Responda em português, máximo 8 linhas, use quebras de linha para organizar. Use emojis com moderação.`;

  const send = async (text) => {
    if (!text || !text.trim() || loading) return;
    const userMsg = text.trim();
    setMsgs(prev => [...prev, { role: "user", text: userMsg }]);
    setInput("");
    setLoading(true);
    const reply = await callGroq(groqKey, systemPrompt, userMsg);
    setMsgs(prev => [...prev, { role: "ai", text: reply }]);
    setLoading(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={css.grid4}>
        {[
          { label:"RECEITA TOTAL", value:fmt(receita), color:"#00e5a0", sub:"↑ Firebase" },
          { label:"DESPESAS", value:fmt(despesa), color:"#ff4f6a", sub:"↓ Firebase" },
          { label:"SALDO LÍQUIDO", value:fmt(saldo), color:"#f5a623", sub:"calculado" },
          { label:"TAXA DE POUPANÇA", value:poupanca+"%", color:"#4d9fff", sub:"meta: 30%" },
        ].map(k => (
          <div key={k.label} style={css.kpi(k.color)}>
            <div style={{ fontFamily:"monospace", fontSize:10, color:"#4a5260", letterSpacing:"0.1em", marginBottom:8 }}>{k.label}</div>
            <div style={{ fontSize:26, fontWeight:800, color:k.color, letterSpacing:"-0.02em", marginBottom:4 }}>{k.value}</div>
            <div style={{ fontSize:11, color:"#4a5260", fontFamily:"monospace" }}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={css.grid2}>
        <div style={css.panel}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>Receitas × Despesas</div>
          <div style={{ fontSize:10, color:"#4a5260", fontFamily:"monospace", marginBottom:16 }}>POR MÊS</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} barSize={14}>
              <XAxis dataKey="mes" tick={{ fill:"#4a5260", fontSize:10 }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fill:"#4a5260", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => "R$"+(v/1000).toFixed(0)+"k"}/>
              <Tooltip contentStyle={{ background:"#181d22", border:"1px solid #ffffff10", borderRadius:8, fontSize:11 }} formatter={v => ["R$ "+Number(v).toLocaleString("pt-BR")]}/>
              <Bar dataKey="receita" fill="#00e5a0" radius={[3,3,0,0]} opacity={0.8}/>
              <Bar dataKey="despesa" fill="#ff4f6a" radius={[3,3,0,0]} opacity={0.7}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={css.panel}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>Distribuição de gastos</div>
          <div style={{ fontSize:10, color:"#4a5260", fontFamily:"monospace", marginBottom:16 }}>POR CATEGORIA</div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={porCategoria} cx="40%" cy="50%" innerRadius={45} outerRadius={65} dataKey="value" paddingAngle={2}>
                {porCategoria.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]}/>)}
              </Pie>
              <Tooltip contentStyle={{ background:"#181d22", border:"1px solid #ffffff10", borderRadius:8, fontSize:11 }} formatter={v => ["R$ "+Number(v).toLocaleString("pt-BR")]}/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 12px", marginTop:4 }}>
            {porCategoria.map((c, i) => (
              <span key={c.name} style={{ fontSize:10, color:"#7a8490", display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ width:6, height:6, borderRadius:"50%", background:CORES[i%CORES.length], display:"inline-block" }}/>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div style={css.gridDash}>
        <div style={css.panel}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>Últimas transações</div>
          <div style={{ fontSize:10, color:"#4a5260", fontFamily:"monospace", marginBottom:14 }}>SINCRONIZADO COM FIREBASE</div>
          {transacoes.length === 0 && <div style={{ fontSize:13, color:"#4a5260", padding:"20px 0" }}>Nenhum lançamento ainda. Adicione na aba Lançamentos!</div>}
          {transacoes.slice(0, 8).map((tx, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"36px 1fr auto", gap:10, alignItems:"center", padding:"9px 10px", borderRadius:8 }}>
              <div style={{ width:36, height:36, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, background:tx.tipo==="receita"?"rgba(0,229,160,0.08)":"rgba(255,79,106,0.08)" }}>
                {ICONES[tx.categoria]||"📦"}
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:500 }}>{tx.descricao}</div>
                <div style={{ fontSize:10, color:"#4a5260", fontFamily:"monospace", marginTop:2 }}>{tx.data} · {tx.categoria}</div>
              </div>
              <div style={{ fontFamily:"monospace", fontSize:13, fontWeight:500, color:tx.tipo==="receita"?"#00e5a0":"#ff4f6a" }}>
                {tx.tipo==="receita"?"+":"−"}R$ {Number(tx.valor).toLocaleString("pt-BR")}
              </div>
            </div>
          ))}
        </div>
        <div style={css.sidebar}>
          <div style={{ padding:"16px 18px 14px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:7 }}>
              <div style={{ ...css.dot, width:6, height:6 }}/>
              Consultora Financeira IA
            </div>
            <div style={{ fontSize:10, color:"#4a5260", fontFamily:"monospace", marginTop:3 }}>GROQ · LLAMA 3.3 70B · GRÁTIS</div>
          </div>
          <div ref={chatRef} style={{ flex:1, overflowY:"auto", padding:14, display:"flex", flexDirection:"column", gap:10 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf:m.role==="user"?"flex-end":"flex-start", maxWidth:"100%" }}>
                <div style={css.msgLabel}>{m.role==="ai"?"FININTELL AI":"VOCÊ"}</div>
                <div style={m.role==="ai" ? css.msgAI : css.msgUser}>{m.text}</div>
                {m.chips && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:8 }}>
                    {m.chips.map(c => <span key={c} style={css.chip} onClick={() => send(c)}>{c}</span>)}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf:"flex-start" }}>
                <div style={css.msgLabel}>FININTELL AI</div>
                <div style={css.msgAI}>⏳ Analisando seus dados...</div>
              </div>
            )}
          </div>
          <div style={{ padding:"12px 14px", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display:"flex", gap:8, background:"#181d22", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:"7px 12px", alignItems:"center" }}>
              <input
                style={{ flex:1, background:"none", border:"none", outline:"none", color:"#e8eaed", fontSize:12, fontFamily:"monospace" }}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && send(input)}
                placeholder="Pergunte ou peça um planejamento..."
              />
              <button
                style={{ width:28, height:28, borderRadius:6, background:"#00e5a0", border:"none", color:"#080b0e", fontWeight:700, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, opacity:loading?0.5:1 }}
                onClick={() => send(input)}
                disabled={loading}
              >→</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LancamentosPage({ transacoes, userId }) {
  const [form, setForm] = useState({ data:"", descricao:"", categoria:"Alimentação", valor:"", tipo:"despesa" });
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.data || !form.descricao || !form.valor) return;
    setLoading(true);
    try {
      await addDoc(collection(db, "users", userId, "transacoes"), { ...form, valor:Number(form.valor), criadoEm:serverTimestamp() });
      setOk(true);
      setForm({ data:"", descricao:"", categoria:"Alimentação", valor:"", tipo:"despesa" });
      setTimeout(() => setOk(false), 2500);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ fontSize:20, fontWeight:800, marginBottom:4 }}>Lançamentos</div>
      <div style={{ fontSize:13, color:"#7a8490", marginBottom:24 }}>Dados salvos no Firebase — sync em todos os dispositivos</div>
      <div style={css.grid2}>
        <div style={css.panel}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:16 }}>Novo lançamento</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div><label style={css.label}>DATA</label><input style={css.fieldInput} type="date" value={form.data} onChange={e=>setForm({...form,data:e.target.value})}/></div>
            <div><label style={css.label}>TIPO</label>
              <select style={css.select} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}>
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom:12 }}><label style={css.label}>DESCRIÇÃO</label><input style={css.fieldInput} placeholder="Ex: Supermercado" value={form.descricao} onChange={e=>setForm({...form,descricao:e.target.value})}/></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
            <div><label style={css.label}>CATEGORIA</label>
              <select style={css.select} value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})}>
                {CATEGORIAS.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label style={css.label}>VALOR (R$)</label><input style={css.fieldInput} type="number" placeholder="0,00" value={form.valor} onChange={e=>setForm({...form,valor:e.target.value})}/></div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button style={{ ...css.btn, width:"auto", padding:"10px 24px", opacity:loading?0.6:1 }} onClick={submit} disabled={loading}>{loading?"Salvando...":"Adicionar"}</button>
            {ok && <span style={{ fontSize:12, color:"#00e5a0" }}>✓ Salvo no Firebase!</span>}
          </div>
        </div>
        <div style={css.panel}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Histórico</div>
          <div style={{ fontSize:11, color:"#4a5260", fontFamily:"monospace", marginBottom:14 }}>{transacoes.length} LANÇAMENTOS · TEMPO REAL</div>
          <div style={{ maxHeight:340, overflowY:"auto" }}>
            {transacoes.map((tx, i) => (
              <div key={i} style={{ display:"grid", gridTemplateColumns:"36px 1fr auto", gap:10, alignItems:"center", padding:"9px 10px", borderBottom:"1px solid rgba(255,255,255,0.04)", borderRadius:8 }}>
                <div style={{ width:36, height:36, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, background:tx.tipo==="receita"?"rgba(0,229,160,0.08)":"rgba(255,79,106,0.08)" }}>{ICONES[tx.categoria]||"📦"}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{tx.descricao}</div>
                  <div style={{ fontSize:10, color:"#4a5260", fontFamily:"monospace", marginTop:2 }}>{tx.data} · {tx.categoria}</div>
                </div>
                <div style={{ fontFamily:"monospace", fontSize:13, color:tx.tipo==="receita"?"#00e5a0":"#ff4f6a" }}>{tx.tipo==="receita"?"+":"−"}R$ {Number(tx.valor).toLocaleString("pt-BR")}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertasPage({ transacoes }) {
  const todos = CATEGORIAS.filter(c=>c!=="Receita").map(cat => ({ name:cat, value:transacoes.filter(t=>t.categoria===cat&&t.tipo==="despesa").reduce((s,t)=>s+Number(t.valor),0) }));
  const alertas = todos.filter(c=>LIMITES[c.name]&&c.value>=LIMITES[c.name]*0.5).map(c=>({ ...c, limite:LIMITES[c.name], pct:Math.round((c.value/LIMITES[c.name])*100), tipo:c.value>LIMITES[c.name]?"critico":"atencao" }));

  return (
    <div>
      <div style={{ fontSize:20, fontWeight:800, marginBottom:4 }}>Alertas</div>
      <div style={{ fontSize:13, color:"#7a8490", marginBottom:24 }}>Monitoramento automático — alertas enviados via Telegram</div>
      <div style={css.grid2}>
        <div>
          <div style={{ fontSize:12, fontWeight:500, color:"#7a8490", marginBottom:12, fontFamily:"monospace" }}>ALERTAS ATIVOS — {alertas.length}</div>
          {alertas.length===0 && <div style={{ fontSize:13, color:"#4a5260", padding:"24px 0" }}>✅ Todos os gastos dentro do limite!</div>}
          {alertas.map(a=>(
            <div key={a.name} style={{ display:"flex", gap:12, alignItems:"flex-start", padding:"12px 14px", borderRadius:8, background:a.tipo==="critico"?"rgba(255,79,106,0.06)":"rgba(245,166,35,0.06)", border:`1px solid ${a.tipo==="critico"?"rgba(255,79,106,0.15)":"rgba(245,166,35,0.15)"}`, marginBottom:8 }}>
              <span style={{ fontSize:20 }}>{a.tipo==="critico"?"🚨":"⚠️"}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>{a.name}</div>
                <div style={{ fontSize:11, color:"#7a8490", fontFamily:"monospace" }}>R$ {a.value.toLocaleString("pt-BR")} / R$ {a.limite.toLocaleString("pt-BR")} — {a.pct}%</div>
                <div style={{ marginTop:8, height:4, background:"rgba(255,255,255,0.06)", borderRadius:2 }}>
                  <div style={{ height:"100%", width:`${Math.min(a.pct,100)}%`, background:a.tipo==="critico"?"#ff4f6a":"#f5a623", borderRadius:2 }}/>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={css.panel}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:14 }}>Limites por categoria</div>
          {Object.entries(LIMITES).map(([cat,lim])=>{
            const gasto = todos.find(c=>c.name===cat)?.value||0;
            const pct = Math.round((gasto/lim)*100);
            return (
              <div key={cat} style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:12 }}>{ICONES[cat]} {cat}</span>
                  <span style={{ fontSize:11, fontFamily:"monospace", color:"#7a8490" }}>R$ {gasto.toLocaleString("pt-BR")} / R$ {lim.toLocaleString("pt-BR")}</span>
                </div>
                <div style={{ height:4, background:"rgba(255,255,255,0.06)", borderRadius:2 }}>
                  <div style={{ height:"100%", width:`${Math.min(pct,100)}%`, background:pct>=100?"#ff4f6a":pct>=50?"#f5a623":"#00e5a0", borderRadius:2, transition:"width .4s" }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [transacoes, setTransacoes] = useState([]);
  // ✅ LINHA CORRIGIDA — lê do localStorage ou do .env automaticamente
  const [groqKey, setGroqKey] = useState(() => localStorage.getItem(GROQ_KEY) || import.meta.env.VITE_GROQ_KEY || "");

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setAuthReady(true); }), []);

  useEffect(() => {
    if (!user) { setTransacoes([]); return; }
    const q = query(collection(db, "users", user.uid, "transacoes"), orderBy("criadoEm", "desc"));
    return onSnapshot(q, snap => setTransacoes(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
  }, [user]);

  const saveKey = k => { localStorage.setItem(GROQ_KEY, k); setGroqKey(k); };
  const initials = user?.displayName?.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() || user?.email?.[0]?.toUpperCase() || "U";

  if (!authReady) return (
    <div style={{ ...css.center, flexDirection:"column", gap:12 }}>
      <div style={css.dot}/>
      <div style={{ fontSize:12, color:"#4a5260", fontFamily:"monospace" }}>Carregando...</div>
    </div>
  );

  if (!user) return <AuthPage/>;

  const tabs = [{id:"dashboard",label:"Dashboard"},{id:"lancamentos",label:"Lançamentos"},{id:"alertas",label:"Alertas"},{id:"config",label:"Config"}];

  return (
    <div style={css.page}>
      <nav style={css.nav}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={css.dot}/>
          <span style={{ fontSize:14, fontWeight:700, letterSpacing:"0.08em" }}>FININTELL</span>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {tabs.map(t => <button key={t.id} style={css.tab(page===t.id)} onClick={()=>setPage(t.id)}>{t.label}</button>)}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, fontFamily:"monospace", background:"rgba(0,229,160,0.1)", color:"#00e5a0", border:"1px solid rgba(0,229,160,0.2)" }}>● FIREBASE</span>
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"#181d22", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"4px 12px 4px 8px" }}>
            <div style={{ width:24, height:24, borderRadius:"50%", background:"#00e5a0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#080b0e" }}>{initials}</div>
            <span style={{ fontSize:12 }}>{user.displayName || user.email?.split("@")[0]}</span>
            <button style={{ fontSize:11, color:"#ff4f6a", cursor:"pointer", background:"none", border:"none", padding:0 }} onClick={()=>signOut(auth)}>Sair</button>
          </div>
        </div>
      </nav>
      <div style={css.main}>
        {page==="dashboard"   && <DashboardPage transacoes={transacoes} groqKey={groqKey}/>}
        {page==="lancamentos" && <LancamentosPage transacoes={transacoes} userId={user.uid}/>}
        {page==="alertas"     && <AlertasPage transacoes={transacoes}/>}
        {page==="config"      && (
          <div>
            <div style={{ fontSize:20, fontWeight:800, marginBottom:4 }}>Configurações</div>
            <div style={{ fontSize:13, color:"#7a8490", marginBottom:24 }}>Conta: {user.email}</div>
            <div style={{ maxWidth:480 }}>
              <div style={css.panel}>
                <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Groq API — IA do Chat</div>
                <div style={{ fontSize:11, color:"#4a5260", fontFamily:"monospace", marginBottom:14 }}>GRATUITA · LLAMA 3.3 70B</div>
                <label style={css.label}>CHAVE API</label>
                <input style={{ ...css.fieldInput, marginBottom:12 }} type="password" defaultValue={groqKey} onChange={e=>saveKey(e.target.value)} placeholder="gsk_xxxxxxxxxxxxxxxx"/>
                <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#4d9fff" }}>Criar chave grátis →</a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}