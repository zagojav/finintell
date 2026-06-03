import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
  getRedirectResult, GoogleAuthProvider, signOut, updateProfile,
  sendPasswordResetEmail
} from "firebase/auth";
import {
  getFirestore, collection, addDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, doc, setDoc, getDoc, getDocs
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
const PRIVADO_KEY = "finintell_privado";

const LIMITES_DESPESA_PADRAO = {
  Alimentação:{limite:1500,icone:"🛒"}, Transporte:{limite:800,icone:"🚗"},
  Lazer:{limite:600,icone:"🎭"}, Saúde:{limite:500,icone:"💊"},
  Moradia:{limite:3000,icone:"🏠"}, Outros:{limite:300,icone:"📦"}
};
const CATS_RECEITA_PADRAO = {
  Salário:{icone:"💼"}, Freelance:{icone:"💻"},
  "Cartão de Crédito":{icone:"💳"}, "Dinheiro Guardado":{icone:"🏦"}, "Outros":{icone:"💰"}
};
const FORMAS_PAGAMENTO = ["—","PIX","Dinheiro","Débito","Crédito","Boleto","Transferência"];
const CORES = ["#4d9fff","#00e5a0","#f5a623","#ff4f6a","#b57bee","#7a8490","#5dcaa5","#f06292","#aed581","#4dd0e1"];
const EMOJIS = ["🏠","🛒","🚗","💊","🎭","📦","🍕","✈️","👕","📱","💡","🐾","📚","💪","🎮","🎵","💈","🌿","💼","💻","💳","🏦","💰","🎓","🐶","🏋️","🎯","🌍","⚽","🎨"];

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;

// ─── GROQ ─────────────────────────────────────────────────────
async function callGroq(key, systemPrompt, userMessage) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
      body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:500,messages:[{role:"system",content:systemPrompt},{role:"user",content:userMessage}]})
    });
    if(!res.ok) return res.status===401?"🔑 Chave Groq inválida. Configure em Config.":"⚠️ Erro na API.";
    const d=await res.json();
    return d.choices?.[0]?.message?.content||"Sem resposta.";
  } catch { return "⚠️ Erro de conexão."; }
}

// ─── HELPERS ──────────────────────────────────────────────────
const fmt = (v, privado) => privado ? "R$ ••••" : "R$ " + Number(v).toLocaleString("pt-BR");
const fmtNum = (v, privado) => privado ? "••••" : Number(v).toLocaleString("pt-BR");

function getMesAtual() {
  const now = new Date();
  return `${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()}`;
}

function calcDados(transacoes) {
  const receita = transacoes.filter(t=>t.tipo==="receita").reduce((s,t)=>s+Number(t.valor),0);
  const despesa = transacoes.filter(t=>t.tipo==="despesa").reduce((s,t)=>s+Number(t.valor),0);
  const saldo = receita - despesa;
  const poupanca = receita > 0 ? Math.round((saldo/receita)*100) : 0;
  const todasCats = [...new Set(transacoes.filter(t=>t.tipo==="despesa").map(t=>t.categoria))];
  const porCategoria = todasCats.map(cat=>({
    name:cat, value:transacoes.filter(t=>t.categoria===cat&&t.tipo==="despesa").reduce((s,t)=>s+Number(t.valor),0)
  })).filter(c=>c.value>0).sort((a,b)=>b.value-a.value);
  const porMes = {};
  transacoes.forEach(tx=>{
    const mes = tx.data?.slice(3,10)||"—";
    if(!porMes[mes]) porMes[mes]={mes,receita:0,despesa:0};
    if(tx.tipo==="receita") porMes[mes].receita+=Number(tx.valor);
    else porMes[mes].despesa+=Number(tx.valor);
  });
  return {receita,despesa,saldo,poupanca,porCategoria,chartData:Object.values(porMes).slice(-6)};
}

// ─── STYLES ──────────────────────────────────────────────────
const css = {
  page:{minHeight:"100vh",background:"#080b0e",color:"#e8eaed",fontFamily:"'DM Sans',system-ui,sans-serif"},
  center:{minHeight:"100vh",background:"#080b0e",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'DM Sans',system-ui,sans-serif"},
  authCard:{background:"#111518",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:28,width:"100%",maxWidth:400},
  nav:{padding:"0 16px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid rgba(255,255,255,0.06)",background:"rgba(8,11,14,0.92)",backdropFilter:"blur(12px)",position:"sticky",top:0,zIndex:100},
  main:{padding:"16px",display:"flex",flexDirection:"column",gap:14},
  grid4:{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10},
  grid2:mob=>({display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:mob?10:14}),
  kpi:c=>({background:"#111518",border:"1px solid rgba(255,255,255,0.06)",borderTop:`2px solid ${c}`,borderRadius:12,padding:"14px",cursor:"default",userSelect:"none"}),
  panel:{background:"#111518",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:16},
  sidebar:{background:"#111518",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,display:"flex",flexDirection:"column"},
  tab:a=>({padding:"6px 14px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:500,background:a?"rgba(0,229,160,0.1)":"transparent",color:a?"#00e5a0":"#7a8490"}),
  btn:{background:"#00e5a0",color:"#080b0e",border:"none",borderRadius:8,padding:"12px 24px",fontSize:13,fontWeight:700,cursor:"pointer",width:"100%"},
  btnSm:{background:"#00e5a0",color:"#080b0e",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"},
  btnGhost:{background:"transparent",color:"#7a8490",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer"},
  btnDanger:{background:"rgba(255,79,106,0.1)",color:"#ff4f6a",border:"1px solid rgba(255,79,106,0.2)",borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer"},
  btnGoogle:{width:"100%",background:"transparent",color:"#e8eaed",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"11px",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:16},
  input:{width:"100%",background:"#181d22",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"11px 14px",color:"#e8eaed",fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:12},
  fieldInput:{width:"100%",background:"#181d22",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"9px 12px",color:"#e8eaed",fontSize:13,outline:"none",boxSizing:"border-box"},
  select:{width:"100%",background:"#181d22",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"9px 12px",color:"#e8eaed",fontSize:13,outline:"none",boxSizing:"border-box"},
  label:{fontSize:11,color:"#7a8490",fontFamily:"monospace",letterSpacing:"0.06em",display:"block",marginBottom:5},
  err:{background:"rgba(255,79,106,0.1)",border:"1px solid rgba(255,79,106,0.2)",borderRadius:6,padding:"8px 12px",fontSize:12,color:"#ff4f6a",marginBottom:12},
  ok:{background:"rgba(0,229,160,0.1)",border:"1px solid rgba(0,229,160,0.2)",borderRadius:6,padding:"8px 12px",fontSize:12,color:"#00e5a0",marginBottom:12},
  dot:{width:7,height:7,borderRadius:"50%",background:"#00e5a0",boxShadow:"0 0 8px #00e5a0"},
  msgAI:{background:"#181d22",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"4px 10px 10px 10px",padding:"10px 13px",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"},
  msgUser:{background:"rgba(77,159,255,0.1)",border:"1px solid rgba(77,159,255,0.15)",borderRadius:"10px 4px 10px 10px",padding:"10px 13px",fontSize:13,lineHeight:1.6,alignSelf:"flex-end",maxWidth:"85%"},
  msgLabel:{fontFamily:"monospace",fontSize:9,color:"#4a5260",marginBottom:3},
  chip:active=>({fontSize:10,padding:"3px 10px",borderRadius:20,background:active?"rgba(0,229,160,0.15)":"rgba(0,229,160,0.06)",color:"#00e5a0",border:active?"1px solid rgba(0,229,160,0.4)":"1px solid rgba(0,229,160,0.15)",cursor:"pointer",fontFamily:"monospace",whiteSpace:"nowrap",fontWeight:active?600:400}),
  alertItem:t=>({display:"flex",gap:12,alignItems:"flex-start",padding:"12px 14px",borderRadius:8,background:t==="critico"?"rgba(255,79,106,0.06)":"rgba(245,166,35,0.06)",border:`1px solid ${t==="critico"?"rgba(255,79,106,0.15)":"rgba(245,166,35,0.15)"}`,marginBottom:8}),
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16,overflowY:"auto"},
  modalBox:{background:"#111518",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,padding:24,width:"100%",maxWidth:440,margin:"auto"},
  lembreteBadge:{background:"rgba(245,166,35,0.1)",border:"1px solid rgba(245,166,35,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:8,display:"flex",gap:10,alignItems:"flex-start"},
  cleanupBanner:{background:"rgba(77,159,255,0.06)",border:"1px solid rgba(77,159,255,0.15)",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10,fontSize:12,color:"#4d9fff"},
};

// ─── AUTH PAGE ────────────────────────────────────────────────
function AuthPage() {
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState("");
  const [senha,setSenha]=useState("");
  const [nome,setNome]=useState("");
  const [erro,setErro]=useState("");
  const [sucesso,setSucesso]=useState("");
  const [loading,setLoading]=useState(false);
  const errMsg=code=>({
    "auth/email-already-in-use":"Email já cadastrado.",
    "auth/wrong-password":"Senha incorreta.",
    "auth/user-not-found":"Usuário não encontrado.",
    "auth/weak-password":"Senha fraca — mínimo 6 caracteres.",
    "auth/invalid-credential":"Email ou senha incorretos.",
    "auth/popup-closed-by-user":"Login cancelado.",
    "auth/invalid-email":"Email inválido.",
    "auth/too-many-requests":"Muitas tentativas. Tente mais tarde.",
  }[code]||"Erro. Tente novamente.");
  const handleEmail=async()=>{
    if(!email||!senha){setErro("Preencha todos os campos.");return;}
    setLoading(true);setErro("");setSucesso("");
    try{
      if(mode==="cadastro"){const cred=await createUserWithEmailAndPassword(auth,email,senha);if(nome)await updateProfile(cred.user,{displayName:nome});}
      else{await signInWithEmailAndPassword(auth,email,senha);}
    }catch(e){setErro(errMsg(e.code));}
    setLoading(false);
  };
  const handleGoogle=async()=>{
    setLoading(true);setErro("");setSucesso("");
    try{if(isMobile()){await signInWithRedirect(auth,googleProvider);}else{await signInWithPopup(auth,googleProvider);}}
    catch(e){setErro(errMsg(e.code));setLoading(false);}
  };
  const handleEsqueci=async()=>{
    if(!email){setErro("Digite seu email acima.");return;}
    setLoading(true);setErro("");setSucesso("");
    try{await sendPasswordResetEmail(auth,email);setSucesso("Email enviado! Verifique sua caixa de entrada.");}
    catch(e){setErro(errMsg(e.code));}
    setLoading(false);
  };
  return (
    <div style={css.center}>
      <div style={css.authCard}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:28}}>
          <div style={css.dot}/><span style={{fontSize:15,fontWeight:800,letterSpacing:"0.08em",color:"#e8eaed"}}>FININTELL</span>
        </div>
        <div style={{fontSize:22,fontWeight:800,color:"#e8eaed",marginBottom:6,letterSpacing:"-0.02em"}}>{mode==="login"?"Bem-vindo de volta":mode==="cadastro"?"Criar conta":"Redefinir senha"}</div>
        <div style={{fontSize:13,color:"#7a8490",marginBottom:24}}>{mode==="login"?"Entre para acessar seu dashboard":mode==="cadastro"?"Comece a controlar suas finanças":"Enviaremos um link para seu email"}</div>
        {mode!=="esqueci"&&<><button style={css.btnGoogle} onClick={handleGoogle} disabled={loading}><svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Continuar com Google</button><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}><div style={{flex:1,height:1,background:"rgba(255,255,255,0.06)"}}/><span style={{fontSize:11,color:"#4a5260",fontFamily:"monospace"}}>ou</span><div style={{flex:1,height:1,background:"rgba(255,255,255,0.06)"}}/></div></>}
        {erro&&<div style={css.err}>{erro}</div>}
        {sucesso&&<div style={css.ok}>{sucesso}</div>}
        {mode==="cadastro"&&<><label style={css.label}>NOME</label><input style={css.input} placeholder="Seu nome" value={nome} onChange={e=>setNome(e.target.value)}/></>}
        <label style={css.label}>EMAIL</label>
        <input style={css.input} type="email" placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(mode==="esqueci"?handleEsqueci():handleEmail())}/>
        {mode!=="esqueci"&&<><label style={css.label}>SENHA</label><input style={{...css.input,marginBottom:mode==="login"?8:20}} type="password" placeholder="••••••••" value={senha} onChange={e=>setSenha(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleEmail()}/></>}
        {mode==="login"&&<div style={{textAlign:"right",marginBottom:16}}><span style={{fontSize:12,color:"#4d9fff",cursor:"pointer"}} onClick={()=>{setMode("esqueci");setErro("");setSucesso("");}}>Esqueci minha senha</span></div>}
        <button style={{...css.btn,opacity:loading?0.6:1,marginBottom:16}} onClick={mode==="esqueci"?handleEsqueci:handleEmail} disabled={loading}>{loading?"Aguarde...":mode==="login"?"Entrar":mode==="cadastro"?"Criar conta":"Enviar link de redefinição"}</button>
        <div style={{fontSize:12,color:"#7a8490",textAlign:"center"}}>
          {mode==="esqueci"?<span style={{color:"#00e5a0",cursor:"pointer",textDecoration:"underline"}} onClick={()=>{setMode("login");setErro("");setSucesso("");}}>← Voltar ao login</span>:<>{mode==="login"?"Não tem conta? ":"Já tem conta? "}<span style={{color:"#00e5a0",cursor:"pointer",textDecoration:"underline"}} onClick={()=>{setMode(mode==="login"?"cadastro":"login");setErro("");setSucesso("");}}>{mode==="login"?"Cadastre-se":"Fazer login"}</span></>}
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────
function DashboardPage({transacoes,groqKey,mob,limitesDespesa,catsReceita,privado,onNavigate,lembretes}) {
  const {receita,despesa,saldo,poupanca,porCategoria,chartData}=calcDados(transacoes);
  const [msgs,setMsgs]=useState([{role:"ai",text:"Olá! Sou sua assistente financeira 💼\n\nPosso ajudar com metas, investimentos, corte de gastos — e também te guio pelo app!",chips:["Como editar um limite?","Quero deletar um lançamento","Como investir meu saldo?","Saúde financeira geral"]}]);
  const [input,setInput]=useState("");
  const [loadingAI,setLoadingAI]=useState(false);
  const [chatAberto,setChatAberto]=useState(!mob);
  const [catFiltro,setCatFiltro]=useState(null);
  const chatRef=useRef(null);
  const mesAtual=getMesAtual();

  useEffect(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},[msgs]);

  // Transações do mês atual filtradas por categoria
  const txMesAtual=transacoes.filter(tx=>tx.data?.slice(3,10)===mesAtual);
  const txFiltradas=catFiltro?txMesAtual.filter(tx=>tx.categoria===catFiltro):txMesAtual;
  const totalFiltro=txFiltradas.filter(t=>t.tipo==="despesa").reduce((s,t)=>s+Number(t.valor),0);

  // Lembretes urgentes (próximos 7 dias)
  const hoje=new Date();
  const lembretesUrgentes=lembretes.filter(l=>{
    const d=new Date(l.proximaData);
    const diff=Math.ceil((d-hoje)/(1000*60*60*24));
    return diff>=0&&diff<=7&&l.ativa;
  });

  // Transações com meses anteriores
  const txAntigos=transacoes.filter(tx=>tx.data&&tx.data.slice(3,10)!==mesAtual);

  const systemPrompt=`Você é assistente financeira do app FININTELL.
DADOS DO USUÁRIO:
- Receita: R$${receita} | Despesas: R$${despesa} | Saldo: R$${saldo} | Poupança: ${poupanca}%
- Categorias de despesa: ${porCategoria.map(c=>`${c.name} R$${c.value}`).join(", ")||"Sem dados"}

GUIA DO APP FININTELL:
- Editar/criar limites/categorias de despesa → aba "Alertas" 🔔 → botão ✏️ ou "+ Nova"
- Criar/editar categorias de receita → aba "Lançamentos" ➕ → seção "Categorias de receita"
- Deletar lançamento → aba "Lançamentos" ➕ → ícone 🗑️ no histórico
- Ver gastos por categoria → aba "Dashboard" 📊 → clique em uma categoria nos chips coloridos
- Parcelamento/lembretes → ao adicionar despesa em "Lançamentos", ativar "Parcelado"
- Ocultar números → ícone de olho 👁️ no canto superior direito do header
- Configurar chave Groq → aba "Config" ⚙️

Responda em pt-BR, máx 6 linhas, seja direta e prática.`;

  const send=async(text)=>{
    if(!text||!text.trim()||loadingAI)return;
    setMsgs(prev=>[...prev,{role:"user",text:text.trim()}]);
    setInput("");setLoadingAI(true);
    const reply=await callGroq(groqKey,systemPrompt,text.trim());
    setMsgs(prev=>[...prev,{role:"ai",text:reply}]);
    setLoadingAI(false);
  };

  const icone=(cat)=>{
    const ld=limitesDespesa[cat];
    const cr=catsReceita[cat];
    return ld?.icone||cr?.icone||"📦";
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* LEMBRETES URGENTES */}
      {lembretesUrgentes.map(l=>(
        <div key={l.id} style={css.lembreteBadge}>
          <span style={{fontSize:20}}>⏰</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:600,color:"#f5a623"}}>{l.descricao} — Parcela {l.parcelaAtual}/{l.totalParcelas}</div>
            <div style={{fontSize:11,color:"#7a8490",fontFamily:"monospace"}}>Vence dia {l.diaVencimento} · {fmt(l.valorParcela,privado)}</div>
          </div>
        </div>
      ))}

      {/* ALERTA CLEANUP */}
      {txAntigos.length>0&&(
        <div style={css.cleanupBanner}>
          <span style={{fontSize:16}}>💡</span>
          <span>Você tem <strong>{txAntigos.length}</strong> lançamentos de meses anteriores. Que tal apagar os irrelevantes na aba <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>onNavigate("lancamentos")}>Lançamentos</span>?</span>
        </div>
      )}

      {/* KPIs */}
      <div style={css.grid4}>
        {[
          {label:"RECEITA",value:fmt(receita,privado),color:"#00e5a0"},
          {label:"DESPESAS",value:fmt(despesa,privado),color:"#ff4f6a"},
          {label:"SALDO",value:fmt(saldo,privado),color:"#f5a623"},
          {label:"POUPANÇA",value:privado?"••%":poupanca+"%",color:"#4d9fff"},
        ].map(k=>(
          <div key={k.label} style={css.kpi(k.color)}>
            <div style={{fontFamily:"monospace",fontSize:9,color:"#4a5260",letterSpacing:"0.1em",marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:mob?18:22,fontWeight:800,color:k.color,letterSpacing:"-0.02em"}}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* FILTRO POR CATEGORIA */}
      <div style={css.panel}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>Filtrar por categoria — {mesAtual}</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:catFiltro?14:0}}>
          {porCategoria.map((c,i)=>(
            <span key={c.name} style={{...css.chip(catFiltro===c.name),background:catFiltro===c.name?`${CORES[i%CORES.length]}22`:"rgba(255,255,255,0.04)",color:catFiltro===c.name?CORES[i%CORES.length]:"#7a8490",border:`1px solid ${catFiltro===c.name?CORES[i%CORES.length]+"44":"rgba(255,255,255,0.08)"}`}} onClick={()=>setCatFiltro(catFiltro===c.name?null:c.name)}>
              {icone(c.name)} {c.name} · {fmt(c.value,privado)}
            </span>
          ))}
          {catFiltro&&<span style={{...css.chip(false),color:"#ff4f6a",border:"1px solid rgba(255,79,106,0.2)"}} onClick={()=>setCatFiltro(null)}>✕ Limpar filtro</span>}
        </div>
        {catFiltro&&(
          <>
            <div style={{fontSize:12,color:"#7a8490",marginBottom:10,fontFamily:"monospace"}}>MOSTRANDO: {catFiltro.toUpperCase()} · TOTAL: <span style={{color:"#ff4f6a"}}>{fmt(totalFiltro,privado)}</span></div>
            <div style={{maxHeight:220,overflowY:"auto"}}>
              {txFiltradas.length===0&&<div style={{fontSize:13,color:"#4a5260"}}>Nenhum lançamento nesta categoria este mês.</div>}
              {txFiltradas.map((tx,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"28px 1fr auto",gap:8,alignItems:"center",padding:"7px 4px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                  <span style={{fontSize:13}}>{icone(tx.categoria)}</span>
                  <div>
                    <div style={{fontSize:12,fontWeight:500}}>{tx.descricao}</div>
                    <div style={{fontSize:10,color:"#4a5260",fontFamily:"monospace"}}>{tx.data}{tx.formaPagamento&&tx.formaPagamento!=="—"?` · ${tx.formaPagamento}`:""}</div>
                  </div>
                  <span style={{fontFamily:"monospace",fontSize:12,color:tx.tipo==="receita"?"#00e5a0":"#ff4f6a"}}>{tx.tipo==="receita"?"+":"−"}{fmt(tx.valor,privado).replace("R$ ","R$")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* CHARTS */}
      {!mob?(
        <div style={css.grid2(false)}>
          <div style={css.panel}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Receitas × Despesas</div>
            <div style={{fontSize:10,color:"#4a5260",fontFamily:"monospace",marginBottom:16}}>POR MÊS</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barSize={14}>
                <XAxis dataKey="mes" tick={{fill:"#4a5260",fontSize:10}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"#4a5260",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>privado?"••":"R$"+(v/1000).toFixed(0)+"k"}/>
                <Tooltip contentStyle={{background:"#181d22",border:"1px solid #ffffff10",borderRadius:8,fontSize:11}} formatter={v=>[privado?"R$ ••••":"R$ "+Number(v).toLocaleString("pt-BR")]}/>
                <Bar dataKey="receita" fill="#00e5a0" radius={[3,3,0,0]} opacity={0.8}/>
                <Bar dataKey="despesa" fill="#ff4f6a" radius={[3,3,0,0]} opacity={0.7}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={css.panel}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Distribuição de gastos</div>
            <div style={{fontSize:10,color:"#4a5260",fontFamily:"monospace",marginBottom:16}}>POR CATEGORIA</div>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={porCategoria} cx="40%" cy="50%" innerRadius={45} outerRadius={65} dataKey="value" paddingAngle={2}>
                  {porCategoria.map((_,i)=><Cell key={i} fill={CORES[i%CORES.length]}/>)}
                </Pie>
                <Tooltip contentStyle={{background:"#181d22",border:"1px solid #ffffff10",borderRadius:8,fontSize:11}} formatter={v=>[privado?"R$ ••••":"R$ "+Number(v).toLocaleString("pt-BR")]}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      ):(
        <div style={css.panel}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>Gastos por categoria</div>
          {porCategoria.length===0&&<div style={{fontSize:12,color:"#4a5260"}}>Nenhum gasto ainda.</div>}
          {porCategoria.map((c,i)=>(
            <div key={c.name} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:12}}>{icone(c.name)} {c.name}</span>
                <span style={{fontSize:11,fontFamily:"monospace",color:"#7a8490"}}>{fmt(c.value,privado)}</span>
              </div>
              <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
                <div style={{height:"100%",width:`${Math.min(Math.round((c.value/(receita||1))*100),100)}%`,background:CORES[i%CORES.length],borderRadius:2}}/>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* HISTÓRICO */}
      <div style={css.panel}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>Últimas transações</div>
        <div style={{fontSize:10,color:"#4a5260",fontFamily:"monospace",marginBottom:12}}>FIREBASE · TEMPO REAL</div>
        {transacoes.length===0&&<div style={{fontSize:13,color:"#4a5260",padding:"12px 0"}}>Nenhum lançamento ainda.</div>}
        {transacoes.slice(0,mob?5:8).map((tx,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"32px 1fr auto",gap:10,alignItems:"center",padding:"8px 4px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
            <div style={{width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,background:tx.tipo==="receita"?"rgba(0,229,160,0.08)":"rgba(255,79,106,0.08)"}}>{icone(tx.categoria)}</div>
            <div>
              <div style={{fontSize:13,fontWeight:500}}>{tx.descricao}</div>
              <div style={{fontSize:10,color:"#4a5260",fontFamily:"monospace"}}>{tx.data} · {tx.categoria}{tx.formaPagamento&&tx.formaPagamento!=="—"?` · ${tx.formaPagamento}`:""}</div>
            </div>
            <div style={{fontFamily:"monospace",fontSize:12,fontWeight:500,color:tx.tipo==="receita"?"#00e5a0":"#ff4f6a"}}>
              {tx.tipo==="receita"?"+":"−"}{fmt(tx.valor,privado).replace("R$ ","R$")}
            </div>
          </div>
        ))}
        {transacoes.length>(mob?5:8)&&<div style={{textAlign:"center",marginTop:10}}><span style={{fontSize:12,color:"#4d9fff",cursor:"pointer"}} onClick={()=>onNavigate("lancamentos")}>Ver todos →</span></div>}
      </div>

      {/* CHAT IA */}
      <div style={css.sidebar}>
        <div style={{padding:"14px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:mob?"pointer":"default"}} onClick={()=>mob&&setChatAberto(v=>!v)}>
          <div>
            <div style={{fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:7}}><div style={{...css.dot,width:6,height:6}}/>Assistente Financeira IA</div>
            <div style={{fontSize:10,color:"#4a5260",fontFamily:"monospace",marginTop:2}}>GROQ · LLAMA 3.3 70B · GRÁTIS</div>
          </div>
          {mob&&<span style={{color:"#7a8490",fontSize:16}}>{chatAberto?"▲":"▼"}</span>}
        </div>
        {chatAberto&&<>
          <div ref={chatRef} style={{overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:10,maxHeight:mob?300:420}}>
            {msgs.map((m,i)=>(
              <div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"100%"}}>
                <div style={css.msgLabel}>{m.role==="ai"?"FININTELL AI":"VOCÊ"}</div>
                <div style={m.role==="ai"?css.msgAI:css.msgUser}>{m.text}</div>
                {m.chips&&<div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:8}}>{m.chips.map(c=><span key={c} style={css.chip(false)} onClick={()=>send(c)}>{c}</span>)}</div>}
              </div>
            ))}
            {loadingAI&&<div style={{alignSelf:"flex-start"}}><div style={css.msgLabel}>FININTELL AI</div><div style={css.msgAI}>⏳ Pensando...</div></div>}
          </div>
          <div style={{padding:"12px 14px",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{display:"flex",gap:8,background:"#181d22",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"7px 12px",alignItems:"center"}}>
              <input style={{flex:1,background:"none",border:"none",outline:"none",color:"#e8eaed",fontSize:12,fontFamily:"monospace"}} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send(input)} placeholder="Pergunte sobre finanças ou o app..."/>
              <button style={{width:28,height:28,borderRadius:6,background:"#00e5a0",border:"none",color:"#080b0e",fontWeight:700,cursor:"pointer",fontSize:16,flexShrink:0,opacity:loadingAI?0.5:1}} onClick={()=>send(input)} disabled={loadingAI}>→</button>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}

// ─── MODAL CATEGORIA ──────────────────────────────────────────
function ModalCategoria({cat,onSave,onClose,semLimite}) {
  const [nome,setNome]=useState(cat?.nome||"");
  const [limite,setLimite]=useState(cat?.limite||"");
  const [icone,setIcone]=useState(cat?.icone||"📦");
  return (
    <div style={css.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={css.modalBox}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>{cat?"Editar categoria":"Nova categoria"}</div>
        <div style={{fontSize:12,color:"#7a8490",marginBottom:16}}>{semLimite?"Categoria de receita — sem limite de gasto":"Limites definem quando você recebe alertas"}</div>
        <label style={css.label}>ÍCONE</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14,background:"#181d22",padding:10,borderRadius:8,maxHeight:120,overflowY:"auto"}}>
          {EMOJIS.map(e=><span key={e} onClick={()=>setIcone(e)} style={{fontSize:18,cursor:"pointer",padding:4,borderRadius:6,background:icone===e?"rgba(0,229,160,0.15)":"transparent",border:icone===e?"1px solid rgba(0,229,160,0.3)":"1px solid transparent"}}>{e}</span>)}
        </div>
        <label style={css.label}>NOME</label>
        <input style={{...css.fieldInput,marginBottom:12}} placeholder="Ex: Freelance, Investimentos..." value={nome} onChange={e=>setNome(e.target.value)} disabled={!!cat?.padrao}/>
        {cat?.padrao&&<div style={{fontSize:11,color:"#4a5260",marginBottom:12,marginTop:-8}}>Categoria padrão — nome fixo</div>}
        {!semLimite&&<><label style={css.label}>LIMITE MENSAL (R$)</label><input style={{...css.fieldInput,marginBottom:20}} type="number" placeholder="Ex: 500" value={limite} onChange={e=>setLimite(e.target.value)}/></>}
        {semLimite&&<div style={{marginBottom:16}}/>}
        <div style={{display:"flex",gap:8}}>
          <button style={css.btnSm} onClick={()=>{if(!nome.trim())return;if(!semLimite&&!limite)return;onSave({nome:nome.trim(),limite:semLimite?0:Number(limite),icone});}}>Salvar</button>
          <button style={css.btnGhost} onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─── LANÇAMENTOS ──────────────────────────────────────────────
function LancamentosPage({transacoes,userId,mob,limitesDespesa,catsReceita,onSaveCatsReceita}) {
  const catsDespesa=Object.keys(limitesDespesa);
  const catsR=Object.keys(catsReceita);
  const [form,setForm]=useState({data:"",descricao:"",categoria:catsDespesa[0]||"Alimentação",valor:"",tipo:"despesa",formaPagamento:"—",parcelado:false,totalParcelas:2,diaVencimento:5});
  const [ok,setOk]=useState(false);
  const [loading,setLoading]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);
  const [deletando,setDeletando]=useState(null);
  const [modalCatR,setModalCatR]=useState(null);
  const [confirmDelCat,setConfirmDelCat]=useState(null);
  const [abaHistorico,setAbaHistorico]=useState("todos");

  const icone=(cat)=>limitesDespesa[cat]?.icone||catsReceita[cat]?.icone||"📦";

  const submit=async()=>{
    if(!form.data||!form.descricao||!form.valor)return;
    setLoading(true);
    try{
      const txData={...form,valor:Number(form.valor),criadoEm:serverTimestamp()};
      delete txData.parcelado; delete txData.totalParcelas; delete txData.diaVencimento;
      await addDoc(collection(db,"users",userId,"transacoes"),txData);

      // Criar lembretes se parcelado
      if(form.parcelado&&form.tipo==="despesa"&&form.totalParcelas>1){
        const dataBase=new Date(form.data.split("/").reverse().join("-"));
        for(let p=2;p<=form.totalParcelas;p++){
          const proxData=new Date(dataBase);
          proxData.setMonth(proxData.getMonth()+(p-1));
          proxData.setDate(form.diaVencimento);
          await addDoc(collection(db,"users",userId,"lembretes"),{
            descricao:form.descricao,
            categoria:form.categoria,
            valorParcela:Number(form.valor),
            totalParcelas:form.totalParcelas,
            parcelaAtual:p,
            diaVencimento:form.diaVencimento,
            proximaData:proxData.toISOString().split("T")[0],
            ativa:true,
            criadoEm:serverTimestamp()
          });
        }
      }

      setOk(true);
      setForm(f=>({...f,data:"",descricao:"",valor:"",formaPagamento:"—",parcelado:false,totalParcelas:2,diaVencimento:5}));
      setTimeout(()=>setOk(false),2500);
    }catch(e){console.error(e);}
    setLoading(false);
  };

  const handleDelete=async(tx)=>{
    setDeletando(tx.id);
    try{await deleteDoc(doc(db,"users",userId,"transacoes",tx.id));}
    catch(e){console.error(e);}
    setDeletando(null);setConfirmDel(null);
  };

  const saveCatR=(dados)=>{
    const novo={...catsReceita};
    if(modalCatR.modo==="novo") novo[dados.nome]={icone:dados.icone};
    else novo[modalCatR.cat]={...novo[modalCatR.cat],icone:dados.icone};
    onSaveCatsReceita(novo);setModalCatR(null);
  };

  const deleteCatR=cat=>{
    const novo={...catsReceita};delete novo[cat];
    onSaveCatsReceita(novo);setConfirmDelCat(null);
  };

  const txFiltradas=abaHistorico==="todos"?transacoes:transacoes.filter(t=>t.tipo===abaHistorico);

  return (
    <div>
      {/* MODAIS */}
      {modalCatR&&<ModalCategoria cat={modalCatR.modo==="editar"?{...catsReceita[modalCatR.cat],nome:modalCatR.cat,padrao:["Salário","Freelance","Outros"].includes(modalCatR.cat)}:null} onSave={saveCatR} onClose={()=>setModalCatR(null)} semLimite={true}/>}
      {confirmDelCat&&(
        <div style={css.modal} onClick={e=>e.target===e.currentTarget&&setConfirmDelCat(null)}>
          <div style={css.modalBox}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Excluir categoria de receita?</div>
            <div style={{fontSize:13,color:"#7a8490",marginBottom:20}}><strong style={{color:"#e8eaed"}}>{confirmDelCat}</strong> será removida.</div>
            <div style={{display:"flex",gap:8}}><button style={{...css.btnDanger,padding:"8px 16px"}} onClick={()=>deleteCatR(confirmDelCat)}>Excluir</button><button style={css.btnGhost} onClick={()=>setConfirmDelCat(null)}>Cancelar</button></div>
          </div>
        </div>
      )}
      {confirmDel&&(
        <div style={css.modal} onClick={e=>e.target===e.currentTarget&&setConfirmDel(null)}>
          <div style={css.modalBox}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Remover lançamento?</div>
            <div style={{background:"#181d22",borderRadius:8,padding:"12px 14px",marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:500,marginBottom:2}}>{confirmDel.descricao}</div>
              <div style={{fontSize:11,color:"#7a8490",fontFamily:"monospace"}}>{confirmDel.data} · {confirmDel.categoria} · R$ {Number(confirmDel.valor).toLocaleString("pt-BR")}</div>
            </div>
            <div style={{fontSize:13,color:"#7a8490",marginBottom:20}}>Este lançamento será excluído permanentemente.</div>
            <div style={{display:"flex",gap:8}}>
              <button style={{...css.btnDanger,padding:"8px 16px",fontSize:13}} onClick={()=>handleDelete(confirmDel)} disabled={deletando===confirmDel.id}>{deletando===confirmDel.id?"Removendo...":"Remover"}</button>
              <button style={css.btnGhost} onClick={()=>setConfirmDel(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:18,fontWeight:800,marginBottom:4}}>Lançamentos</div>
      <div style={{fontSize:13,color:"#7a8490",marginBottom:20}}>Adicione despesas e receitas com forma de pagamento e parcelamento</div>

      <div style={css.grid2(mob)}>
        {/* FORMULÁRIO */}
        <div style={css.panel}>
          <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Novo lançamento</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><label style={css.label}>DATA</label><input style={css.fieldInput} type="date" value={form.data} onChange={e=>setForm({...form,data:e.target.value})}/></div>
            <div><label style={css.label}>TIPO</label>
              <select style={css.select} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value,categoria:e.target.value==="receita"?catsR[0]||"Salário":catsDespesa[0]||"Alimentação"})}>
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
              </select>
            </div>
          </div>
          <div style={{marginBottom:12}}><label style={css.label}>DESCRIÇÃO</label><input style={css.fieldInput} placeholder="Ex: Supermercado, Salário..." value={form.descricao} onChange={e=>setForm({...form,descricao:e.target.value})}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><label style={css.label}>CATEGORIA</label>
              <select style={css.select} value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})}>
                {(form.tipo==="receita"?catsR:catsDespesa).map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label style={css.label}>VALOR (R$)</label><input style={css.fieldInput} type="number" placeholder="0,00" value={form.valor} onChange={e=>setForm({...form,valor:e.target.value})}/></div>
          </div>
          <div style={{marginBottom:12}}><label style={css.label}>FORMA DE PAGAMENTO (OPCIONAL)</label>
            <select style={css.select} value={form.formaPagamento} onChange={e=>setForm({...form,formaPagamento:e.target.value})}>
              {FORMAS_PAGAMENTO.map(f=><option key={f}>{f}</option>)}
            </select>
          </div>

          {/* PARCELAMENTO */}
          {form.tipo==="despesa"&&(
            <div style={{background:"#181d22",borderRadius:8,padding:"12px",marginBottom:16}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:form.parcelado?12:0}}>
                <input type="checkbox" checked={form.parcelado} onChange={e=>setForm({...form,parcelado:e.target.checked})} style={{accentColor:"#00e5a0",width:14,height:14}}/>
                <span style={{fontSize:13,fontWeight:500}}>Parcelado</span>
                <span style={{fontSize:11,color:"#4a5260"}}>— cria lembretes automáticos</span>
              </label>
              {form.parcelado&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:4}}>
                  <div><label style={css.label}>TOTAL DE PARCELAS</label>
                    <select style={css.select} value={form.totalParcelas} onChange={e=>setForm({...form,totalParcelas:Number(e.target.value)})}>
                      {[2,3,4,5,6,7,8,9,10,11,12].map(n=><option key={n} value={n}>{n}x</option>)}
                    </select>
                  </div>
                  <div><label style={css.label}>DIA DO VENCIMENTO</label>
                    <input style={css.fieldInput} type="number" min="1" max="28" placeholder="Ex: 5" value={form.diaVencimento} onChange={e=>setForm({...form,diaVencimento:Number(e.target.value)})}/>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button style={{...css.btn,width:"auto",padding:"10px 24px",opacity:loading?0.6:1}} onClick={submit} disabled={loading}>{loading?"Salvando...":"Adicionar"}</button>
            {ok&&<span style={{fontSize:12,color:"#00e5a0"}}>✓ Salvo!</span>}
          </div>
        </div>

        {/* HISTÓRICO + CATS RECEITA */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={css.panel}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontSize:14,fontWeight:600}}>Histórico</div>
              <div style={{display:"flex",gap:4}}>
                {["todos","despesa","receita"].map(a=><button key={a} style={{...css.tab(abaHistorico===a),fontSize:10,padding:"3px 8px"}} onClick={()=>setAbaHistorico(a)}>{a==="todos"?"Todos":a==="despesa"?"Despesas":"Receitas"}</button>)}
              </div>
            </div>
            <div style={{fontSize:11,color:"#4a5260",marginBottom:12}}>Toque no 🗑️ para remover</div>
            <div style={{maxHeight:320,overflowY:"auto"}}>
              {txFiltradas.length===0&&<div style={{fontSize:13,color:"#4a5260",padding:"10px 0"}}>Nenhum lançamento.</div>}
              {txFiltradas.map((tx,i)=>(
                <div key={tx.id||i} style={{display:"grid",gridTemplateColumns:"28px 1fr auto",gap:8,alignItems:"center",padding:"7px 4px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                  <div style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,background:tx.tipo==="receita"?"rgba(0,229,160,0.08)":"rgba(255,79,106,0.08)"}}>{icone(tx.categoria)}</div>
                  <div>
                    <div style={{fontSize:12,fontWeight:500}}>{tx.descricao}</div>
                    <div style={{fontSize:10,color:"#4a5260",fontFamily:"monospace"}}>{tx.data}{tx.formaPagamento&&tx.formaPagamento!=="—"?` · ${tx.formaPagamento}`:""}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontFamily:"monospace",fontSize:11,color:tx.tipo==="receita"?"#00e5a0":"#ff4f6a"}}>{tx.tipo==="receita"?"+":"−"}R${Number(tx.valor).toLocaleString("pt-BR")}</span>
                    <button style={{background:"none",border:"none",cursor:"pointer",fontSize:12,opacity:0.5,padding:2}} onClick={()=>setConfirmDel(tx)}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CATEGORIAS DE RECEITA */}
          <div style={css.panel}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:14,fontWeight:600}}>Categorias de receita</div>
              <button style={{...css.btnSm,fontSize:11,padding:"4px 10px"}} onClick={()=>setModalCatR({modo:"novo"})}>+ Nova</button>
            </div>
            {Object.entries(catsReceita).map(([cat,info])=>(
              <div key={cat} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                <span style={{fontSize:12}}>{info.icone} {cat}</span>
                <div style={{display:"flex",gap:4}}>
                  <button style={{...css.btnGhost,padding:"2px 8px",fontSize:11}} onClick={()=>setModalCatR({modo:"editar",cat})}>✏️</button>
                  <button style={{...css.btnDanger,padding:"2px 8px",fontSize:11}} onClick={()=>setConfirmDelCat(cat)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ALERTAS ──────────────────────────────────────────────────
function AlertasPage({transacoes,mob,limitesDespesa,onSaveLimitesDespesa,lembretes,userId}) {
  const [modal,setModal]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const gastosPorCat={};
  transacoes.filter(t=>t.tipo==="despesa").forEach(tx=>{gastosPorCat[tx.categoria]=(gastosPorCat[tx.categoria]||0)+Number(tx.valor);});
  const alertas=Object.entries(limitesDespesa).filter(([cat,info])=>(gastosPorCat[cat]||0)>=info.limite*0.5).map(([cat,info])=>{const g=gastosPorCat[cat]||0;const pct=Math.round((g/info.limite)*100);return{cat,gasto:g,limite:info.limite,icone:info.icone,pct,tipo:g>info.limite?"critico":"atencao"};});

  const handleSave=(catKey,dados)=>{const novo={...limitesDespesa};if(modal.modo==="novo")novo[dados.nome]={limite:dados.limite,icone:dados.icone};else novo[catKey]={...novo[catKey],limite:dados.limite,icone:dados.icone};onSaveLimitesDespesa(novo);setModal(null);};
  const handleDelete=cat=>{const novo={...limitesDespesa};delete novo[cat];onSaveLimitesDespesa(novo);setConfirmDel(null);};

  const dispensarLembrete=async(id)=>{
    await deleteDoc(doc(db,"users",userId,"lembretes",id));
  };

  return (
    <div>
      {modal&&<ModalCategoria cat={modal.modo==="editar"?{...limitesDespesa[modal.cat],nome:modal.cat,padrao:!!LIMITES_DESPESA_PADRAO[modal.cat]}:null} onSave={d=>handleSave(modal.cat,d)} onClose={()=>setModal(null)}/>}
      {confirmDel&&(
        <div style={css.modal} onClick={e=>e.target===e.currentTarget&&setConfirmDel(null)}>
          <div style={css.modalBox}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Excluir categoria?</div>
            <div style={{fontSize:13,color:"#7a8490",marginBottom:20}}><strong style={{color:"#e8eaed"}}>{confirmDel}</strong> será removida.</div>
            <div style={{display:"flex",gap:8}}><button style={{...css.btnDanger,padding:"8px 16px"}} onClick={()=>handleDelete(confirmDel)}>Excluir</button><button style={css.btnGhost} onClick={()=>setConfirmDel(null)}>Cancelar</button></div>
          </div>
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div><div style={{fontSize:18,fontWeight:800,marginBottom:4}}>Alertas & Categorias</div><div style={{fontSize:13,color:"#7a8490"}}>Gerencie limites de gastos e lembretes de parcelas</div></div>
        <button style={css.btnSm} onClick={()=>setModal({modo:"novo"})}>+ Nova</button>
      </div>

      {/* LEMBRETES DE PARCELAS */}
      {lembretes.length>0&&(
        <div style={{marginBottom:20}}>
          <div style={{fontSize:12,fontWeight:500,color:"#7a8490",marginBottom:10,fontFamily:"monospace"}}>LEMBRETES DE PARCELAS — {lembretes.filter(l=>l.ativa).length}</div>
          {lembretes.filter(l=>l.ativa).map(l=>{
            const d=new Date(l.proximaData);
            const hoje=new Date();
            const diff=Math.ceil((d-hoje)/(1000*60*60*24));
            const urgente=diff>=0&&diff<=7;
            return (
              <div key={l.id} style={{...css.lembreteBadge,border:`1px solid ${urgente?"rgba(245,166,35,0.3)":"rgba(255,255,255,0.08)"}`,background:urgente?"rgba(245,166,35,0.08)":"#111518",marginBottom:8}}>
                <span style={{fontSize:18}}>{urgente?"⏰":"📅"}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:urgente?"#f5a623":"#e8eaed"}}>{l.descricao}</div>
                  <div style={{fontSize:11,color:"#7a8490",fontFamily:"monospace"}}>Parcela {l.parcelaAtual}/{l.totalParcelas} · Dia {l.diaVencimento} · R$ {Number(l.valorParcela).toLocaleString("pt-BR")}</div>
                  <div style={{fontSize:11,color:urgente?"#f5a623":"#4a5260",marginTop:2}}>{urgente?`⚠️ Vence em ${diff} dia${diff!==1?"s":""}!`:`Próximo vencimento: ${l.proximaData}`}</div>
                </div>
                <button style={{...css.btnGhost,padding:"4px 10px",fontSize:11}} onClick={()=>dispensarLembrete(l.id)}>Dispensar</button>
              </div>
            );
          })}
        </div>
      )}

      <div style={css.grid2(mob)}>
        <div>
          <div style={{fontSize:12,fontWeight:500,color:"#7a8490",marginBottom:12,fontFamily:"monospace"}}>ALERTAS ATIVOS — {alertas.length}</div>
          {alertas.length===0&&<div style={{...css.panel,fontSize:13,color:"#4a5260"}}>✅ Todos os gastos dentro do limite!</div>}
          {alertas.map(a=>(
            <div key={a.cat} style={css.alertItem(a.tipo)}>
              <span style={{fontSize:18}}>{a.tipo==="critico"?"🚨":"⚠️"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{a.icone} {a.cat}</div>
                <div style={{fontSize:11,color:"#7a8490",fontFamily:"monospace"}}>R$ {a.gasto.toLocaleString("pt-BR")} / R$ {a.limite.toLocaleString("pt-BR")} — {a.pct}%</div>
                <div style={{marginTop:6,height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
                  <div style={{height:"100%",width:`${Math.min(a.pct,100)}%`,background:a.tipo==="critico"?"#ff4f6a":"#f5a623",borderRadius:2}}/>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={css.panel}>
          <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Categorias de despesa</div>
          {Object.entries(limitesDespesa).map(([cat,info],i)=>{
            const gasto=gastosPorCat[cat]||0;const pct=Math.round((gasto/info.limite)*100);
            return (
              <div key={cat} style={{marginBottom:12,paddingBottom:12,borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <span style={{fontSize:12,fontWeight:500}}>{info.icone} {cat}</span>
                  <div style={{display:"flex",gap:5,alignItems:"center"}}>
                    <span style={{fontSize:10,fontFamily:"monospace",color:"#7a8490"}}>R${gasto.toLocaleString("pt-BR")}/R${info.limite.toLocaleString("pt-BR")}</span>
                    <button style={{...css.btnGhost,padding:"2px 7px",fontSize:10}} onClick={()=>setModal({modo:"editar",cat})}>✏️</button>
                    <button style={{...css.btnDanger,padding:"2px 7px",fontSize:10}} onClick={()=>setConfirmDel(cat)}>🗑️</button>
                  </div>
                </div>
                <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
                  <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:pct>=100?"#ff4f6a":pct>=50?"#f5a623":CORES[i%CORES.length],borderRadius:2,transition:"width .4s"}}/>
                </div>
              </div>
            );
          })}
          <button style={{...css.btnGhost,width:"100%",marginTop:4,fontSize:12}} onClick={()=>setModal({modo:"novo"})}>+ Adicionar categoria de despesa</button>
        </div>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState(null);
  const [authReady,setAuthReady]=useState(false);
  const [page,setPage]=useState("dashboard");
  const [transacoes,setTransacoes]=useState([]);
  const [lembretes,setLembretes]=useState([]);
  const [limitesDespesa,setLimitesDespesa]=useState(LIMITES_DESPESA_PADRAO);
  const [catsReceita,setCatsReceita]=useState(CATS_RECEITA_PADRAO);
  const [groqKey,setGroqKey]=useState(()=>localStorage.getItem(GROQ_KEY)||import.meta.env.VITE_GROQ_KEY||"");
  const [privado,setPrivado]=useState(()=>localStorage.getItem(PRIVADO_KEY)==="true");
  const [mob,setMob]=useState(isMobile());

  useEffect(()=>{const h=()=>setMob(isMobile());window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  useEffect(()=>onAuthStateChanged(auth,u=>{setUser(u);setAuthReady(true);}),[]);
  useEffect(()=>{getRedirectResult(auth).catch(()=>{});},[]);

  useEffect(()=>{
    if(!user)return;
    getDoc(doc(db,"users",user.uid,"config","dados")).then(snap=>{
      if(snap.exists()){
        const d=snap.data();
        if(d.limitesDespesa)setLimitesDespesa(d.limitesDespesa);
        if(d.catsReceita)setCatsReceita(d.catsReceita);
      }
    });
  },[user]);

  useEffect(()=>{
    if(!user){setTransacoes([]);return;}
    const q=query(collection(db,"users",user.uid,"transacoes"),orderBy("criadoEm","desc"));
    return onSnapshot(q,snap=>setTransacoes(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[user]);

  useEffect(()=>{
    if(!user){setLembretes([]);return;}
    const q=query(collection(db,"users",user.uid,"lembretes"),orderBy("proximaData"));
    return onSnapshot(q,snap=>setLembretes(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[user]);

  const saveConfig=async(ld,cr)=>{
    if(user)await setDoc(doc(db,"users",user.uid,"config","dados"),{limitesDespesa:ld,catsReceita:cr});
  };
  const saveLimitesDespesa=async nd=>{setLimitesDespesa(nd);await saveConfig(nd,catsReceita);};
  const saveCatsReceita=async nc=>{setCatsReceita(nc);await saveConfig(limitesDespesa,nc);};

  const togglePrivado=()=>{
    const novo=!privado;
    setPrivado(novo);
    localStorage.setItem(PRIVADO_KEY,String(novo));
  };

  const saveKey=k=>{localStorage.setItem(GROQ_KEY,k);setGroqKey(k);};
  const initials=user?.displayName?.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase()||user?.email?.[0]?.toUpperCase()||"U";

  if(!authReady)return(<div style={{...css.center,flexDirection:"column",gap:12}}><div style={css.dot}/><div style={{fontSize:12,color:"#4a5260",fontFamily:"monospace"}}>Carregando...</div></div>);
  if(!user)return <AuthPage/>;

  const tabs=[
    {id:"dashboard",label:"Dashboard",icon:"📊"},
    {id:"lancamentos",label:"Lançar",icon:"➕"},
    {id:"alertas",label:"Alertas",icon:"🔔"},
    {id:"config",label:"Config",icon:"⚙️"},
  ];

  // Badge lembretes urgentes
  const lembretesUrgentes=lembretes.filter(l=>{const d=new Date(l.proximaData);const diff=Math.ceil((d-new Date())/(1000*60*60*24));return diff>=0&&diff<=7&&l.ativa;}).length;

  return (
    <div style={css.page}>
      <nav style={{...css.nav,padding:mob?"0 12px":"0 28px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={css.dot}/>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:"0.08em"}}>FININTELL</span>
        </div>
        {!mob&&<div style={{display:"flex",gap:4}}>{tabs.map(t=><button key={t.id} style={css.tab(page===t.id)} onClick={()=>setPage(t.id)}>{t.label}{t.id==="alertas"&&lembretesUrgentes>0?<span style={{marginLeft:4,background:"#f5a623",color:"#080b0e",borderRadius:10,fontSize:9,padding:"1px 5px",fontWeight:700}}>{lembretesUrgentes}</span>:null}</button>)}</div>}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {/* BOTÃO PRIVACIDADE */}
          <button onClick={togglePrivado} style={{background:"none",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,cursor:"pointer",padding:"4px 8px",fontSize:16,lineHeight:1,color:privado?"#ff4f6a":"#7a8490"}} title={privado?"Mostrar valores":"Ocultar valores"}>
            {privado?"🙈":"👁️"}
          </button>
          {!mob&&<span style={{fontSize:10,padding:"3px 10px",borderRadius:20,fontFamily:"monospace",background:"rgba(0,229,160,0.1)",color:"#00e5a0",border:"1px solid rgba(0,229,160,0.2)"}}>● FIREBASE</span>}
          <div style={{display:"flex",alignItems:"center",gap:6,background:"#181d22",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"4px 10px 4px 6px"}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:"#00e5a0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#080b0e"}}>{initials}</div>
            {!mob&&<span style={{fontSize:12}}>{user.displayName||user.email?.split("@")[0]}</span>}
            <button style={{fontSize:11,color:"#ff4f6a",cursor:"pointer",background:"none",border:"none",padding:0}} onClick={()=>signOut(auth)}>Sair</button>
          </div>
        </div>
      </nav>

      {mob&&(
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(8,11,14,0.96)",backdropFilter:"blur(12px)",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom,8px)"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setPage(t.id)} style={{flex:1,padding:"10px 4px",border:"none",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",position:"relative"}}>
              <span style={{fontSize:18}}>{t.icon}</span>
              {t.id==="alertas"&&lembretesUrgentes>0&&<span style={{position:"absolute",top:6,right:"50%",marginRight:-14,background:"#f5a623",color:"#080b0e",borderRadius:10,fontSize:9,padding:"1px 5px",fontWeight:700}}>{lembretesUrgentes}</span>}
              <span style={{fontSize:9,fontFamily:"monospace",color:page===t.id?"#00e5a0":"#4a5260",letterSpacing:"0.04em"}}>{t.label.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{...css.main,paddingBottom:mob?"88px":"24px",maxWidth:"1400px",margin:"0 auto",width:"100%"}}>
        {page==="dashboard"&&<DashboardPage transacoes={transacoes} groqKey={groqKey} mob={mob} limitesDespesa={limitesDespesa} catsReceita={catsReceita} privado={privado} onNavigate={setPage} lembretes={lembretes}/>}
        {page==="lancamentos"&&<LancamentosPage transacoes={transacoes} userId={user.uid} mob={mob} limitesDespesa={limitesDespesa} catsReceita={catsReceita} onSaveCatsReceita={saveCatsReceita}/>}
        {page==="alertas"&&<AlertasPage transacoes={transacoes} mob={mob} limitesDespesa={limitesDespesa} onSaveLimitesDespesa={saveLimitesDespesa} lembretes={lembretes} userId={user.uid}/>}
        {page==="config"&&(
          <div>
            <div style={{fontSize:18,fontWeight:800,marginBottom:4}}>Configurações</div>
            <div style={{fontSize:13,color:"#7a8490",marginBottom:20}}>Conta: {user.email}</div>
            <div style={{maxWidth:480,display:"flex",flexDirection:"column",gap:12}}>
              <div style={css.panel}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Groq API — IA do Chat</div>
                <div style={{fontSize:11,color:"#4a5260",fontFamily:"monospace",marginBottom:14}}>GRATUITA · LLAMA 3.3 70B</div>
                <label style={css.label}>CHAVE API</label>
                <input style={{...css.fieldInput,marginBottom:12}} type="password" defaultValue={groqKey} onChange={e=>saveKey(e.target.value)} placeholder="gsk_xxxxxxxxxxxxxxxx"/>
                <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{fontSize:11,color:"#4d9fff"}}>Criar chave grátis →</a>
              </div>
              <div style={css.panel}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Privacidade</div>
                <div style={{fontSize:13,color:"#7a8490",marginBottom:12}}>Ocultar todos os valores financeiros do app</div>
                <button style={{...privado?css.btnSm:{...css.btnGhost,color:"#e8eaed"}}} onClick={togglePrivado}>{privado?"🙈 Valores ocultos — clique para mostrar":"👁️ Valores visíveis — clique para ocultar"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}