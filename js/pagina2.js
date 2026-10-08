import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";


const firebaseConfig = {
  apiKey: "AIzaSyCi8dT3Sa874hp27HYT0zP8NXVIT6IWjBQ",
  authDomain: "tccds-27acc.firebaseapp.com",
  projectId: "tccds-27acc",
  storageBucket: "tccds-27acc.firebasestorage.app",
  messagingSenderId: "845260539844",
  appId: "1:845260539844:web:997bab3cd98933eb27c691",
  measurementId: "G-NQQXF342YT"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ================= AVISOS NO PRÓPRIO SITE (sem alert() do navegador) =================
// alert() é uma caixa do navegador, não faz parte do site — por isso os
// erros pareciam "do navegador". Esse aviso aparece dentro da própria página.
let avisoTimeoutId = null;

function mostrarAviso(mensagem, tipo = "erro") {
  const elemento = document.getElementById("avisoFlutuante");

  if (!elemento) {
    console.error(mensagem);
    return;
  }

  elemento.textContent = mensagem;
  elemento.className = `aviso-flutuante aviso-${tipo} aviso-visivel`;

  if (avisoTimeoutId) clearTimeout(avisoTimeoutId);
  avisoTimeoutId = setTimeout(() => {
    elemento.classList.remove("aviso-visivel");
  }, 4000);
}

// Rede de segurança: se algum erro inesperado acontecer, mostra um aviso no
// site em vez de deixar a tela travada em silêncio (o erro técnico continua
// indo pro console, para quem for depurar).
window.addEventListener("error", (evento) => {
  if (evento && evento.error) {
    console.error(evento.error);
    mostrarAviso("Ocorreu um erro inesperado. Tente novamente.", "erro");
  }
});

// ================= FAVORITOS E DESPENSA (Firestore) =================
// Ficam guardados na conta do usuário, no Firestore:
//   usuarios/{uid}/favoritos/{idDaReceita}   -> um documento por receita favorita
//   usuarios/{uid}/despensa/atual            -> a lista de ingredientes da pessoa
// Assim eles acompanham a conta em qualquer aparelho. Uma cópia local (no
// navegador) serve de reserva caso o Firestore esteja indisponível.
let usuarioAtual = null;
let receitaAtual = null;
let favoritosIds = [];

function chaveLocalFavoritos() {
  return `cooktosave_fav_ids_${usuarioAtual ? usuarioAtual.uid : "anonimo"}`;
}

// Formato antigo (versões anteriores guardavam a receita inteira no navegador)
function chaveLegadaFavoritos() {
  return usuarioAtual ? `cooktosave_favoritos_${usuarioAtual.uid}` : "cooktosave_favoritos";
}

function chaveMigracaoFavoritos() {
  return `cooktosave_fav_migrado_${usuarioAtual ? usuarioAtual.uid : "anonimo"}`;
}

function chaveLocalDespensa() {
  return `cooktosave_despensa_${usuarioAtual ? usuarioAtual.uid : "anonimo"}`;
}

function idsValidos(ids) {
  return [...new Set((ids || []).map(String))].filter(id => RECEITAS.some(r => r.id === id));
}

function lerLocalFavoritos() {
  try {
    const ids = JSON.parse(localStorage.getItem(chaveLocalFavoritos()));
    if (Array.isArray(ids)) return idsValidos(ids);
  } catch { /* ignora */ }
  return [];
}

function lerFavoritosLegados() {
  try {
    const legado = JSON.parse(localStorage.getItem(chaveLegadaFavoritos()));
    if (Array.isArray(legado)) return idsValidos(legado.map(item => item && item.id));
  } catch { /* ignora */ }
  return [];
}

function salvarLocalFavoritos() {
  try {
    localStorage.setItem(chaveLocalFavoritos(), JSON.stringify(favoritosIds));
  } catch { /* se o navegador estiver sem espaço, segue só com o Firestore */ }
}

function refFavorito(id) {
  return doc(db, "usuarios", usuarioAtual.uid, "favoritos", id);
}

function atualizarContadorFavoritos() {
  const contador = document.getElementById("contadorFavoritos");
  if (contador) contador.textContent = favoritosIds.length;
}

function receitaEstaFavoritada(id) {
  return favoritosIds.includes(String(id));
}

// Carrega os favoritos da conta. Se for a primeira vez e a pessoa tinha
// favoritos no formato antigo (só no navegador), eles são enviados pra conta.
async function carregarFavoritos() {

  try {

    const snapshot = await getDocs(collection(db, "usuarios", usuarioAtual.uid, "favoritos"));

    const remotos = snapshot.docs
      .map(item => {
        const criadoEm = item.data().criadoEm;
        return { id: item.id, t: criadoEm && criadoEm.toMillis ? criadoEm.toMillis() : 0 };
      })
      .sort((a, b) => a.t - b.t)
      .map(item => item.id);

    const legados = lerFavoritosLegados();
    const jaMigrou = localStorage.getItem(chaveMigracaoFavoritos()) === "1";

    if (remotos.length === 0 && legados.length > 0 && !jaMigrou) {
      favoritosIds = legados;
      await Promise.all(
        legados.map(id => setDoc(refFavorito(id), { criadoEm: serverTimestamp() }))
      );
    } else {
      favoritosIds = idsValidos(remotos);
    }

    try { localStorage.setItem(chaveMigracaoFavoritos(), "1"); } catch { /* ignora */ }

  } catch (erro) {

    console.error(erro);
    favoritosIds = lerLocalFavoritos();
    mostrarAviso("Não foi possível sincronizar seus favoritos agora. Mostrando os salvos neste aparelho.", "erro");

  }

  salvarLocalFavoritos();
  atualizarContadorFavoritos();

}

// Liga/desliga um favorito. A tela atualiza na hora; a gravação na conta
// acontece em seguida (se falhar, avisa e o favorito fica salvo só neste aparelho).
async function alternarFavorito(id) {

  if (!usuarioAtual) return;

  id = String(id);
  const jaEra = receitaEstaFavoritada(id);

  favoritosIds = jaEra
    ? favoritosIds.filter(item => item !== id)
    : [...favoritosIds, id];

  salvarLocalFavoritos();
  atualizarContadorFavoritos();

  try {
    if (jaEra) {
      await deleteDoc(refFavorito(id));
    } else {
      await setDoc(refFavorito(id), { criadoEm: serverTimestamp() });
    }
  } catch (erro) {
    console.error(erro);
    mostrarAviso("Não foi possível sincronizar esse favorito com a sua conta. Ele ficou salvo só neste aparelho.", "erro");
  }

}

window.favoritarReceitaAtual = async function () {
  if (!receitaAtual) return;

  const dadosAtuais = receitaAtual;
  const promessa = alternarFavorito(dadosAtuais.id);

  // atualiza o botão na hora (a lista local já mudou)
  renderizarReceita(dadosAtuais);

  await promessa;
};

window.removerFavorito = async function (id) {
  await removerFavoritoDaLista(id);
};

async function removerFavoritoDaLista(id) {
  const promessa = alternarFavorito(id);
  renderizarListaFavoritos();
  await promessa;
}

function renderizarListaFavoritos() {

  const receitas = favoritosIds
    .map(id => RECEITAS.find(r => r.id === id))
    .filter(Boolean);

  if (receitas.length === 0) {
    document.getElementById("resultado").innerHTML = `
      <div class="empty-state">
        <div class="favorite-empty-icon">♡</div>
        <h2 class="text-xl mb-2">Você ainda não tem favoritos</h2>
        <p class="text-muted mb-5">
          Abra uma receita e clique em “Favoritar receita” para guardá-la aqui.
        </p>
        <button onclick="document.getElementById('ingredientes').focus()" class="btn btn-outline">
          Buscar uma receita
        </button>
      </div>
    `;
    return;
  }

  let html = `
    <div class="favorites-header">
      <div>
        <h2 class="text-2xl mb-1">Minhas receitas favoritas</h2>
        <p class="text-muted">${receitas.length} receita(s) salva(s)</p>
      </div>
    </div>

    <div class="results-grid">
  `;

  receitas.forEach(receita => {
    html += `
      <div class="recipe-card favorite-card">
        <div class="recipe-illustration">${gerarIlustracaoSvg(receita.categoria)}</div>
        <div class="body">
          <h3 class="mb-3">${receita.titulo}</h3>

          <div class="favorite-actions">
            <button class="btn btn-primary" onclick="abrirFavorito('${receita.id}')">
              Ver receita
            </button>

            <button class="btn btn-danger" onclick="removerFavorito('${receita.id}')">
              Remover
            </button>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;

  document.getElementById("resultado").innerHTML = html;
}

window.mostrarFavoritos = function () {
  history.pushState({ tipo: "favoritos" }, "");
  renderizarListaFavoritos();
};

window.abrirFavorito = function (id) {
  const receita = RECEITAS.find(r => r.id === String(id));

  if (!receita) {
    renderizarListaFavoritos();
    return;
  }

  const dados = montarDadosReceita(receita);

  history.pushState({ tipo: "receita", dados }, "");

  receitaAtual = dados;
  renderizarReceita(dados);
};


// ================= DESPENSA (lista de ingredientes salva na conta) =================
function lerLocalDespensa() {
  try {
    const itens = JSON.parse(localStorage.getItem(chaveLocalDespensa()));
    if (Array.isArray(itens)) return itens.map(String);
  } catch { /* ignora */ }
  return [];
}

function preencherCampoIngredientes(itens) {
  const campo = document.getElementById("ingredientes");
  if (campo && itens.length > 0 && campo.value.trim() === "") {
    campo.value = itens.join(", ");
  }
}

async function carregarDespensa() {

  let itens = [];

  try {
    const snapshot = await getDoc(doc(db, "usuarios", usuarioAtual.uid, "despensa", "atual"));
    if (snapshot.exists() && Array.isArray(snapshot.data().itens)) {
      itens = snapshot.data().itens.map(String);
    }
  } catch (erro) {
    // o aviso de falha já é mostrado ao carregar os favoritos (mesma causa)
    console.error(erro);
    itens = lerLocalDespensa();
  }

  preencherCampoIngredientes(itens);

}

// Guarda a lista atual. Roda em segundo plano — se falhar, a busca segue normal.
async function salvarDespensa(itens) {

  if (!usuarioAtual) return;

  try {
    localStorage.setItem(chaveLocalDespensa(), JSON.stringify(itens));
  } catch { /* ignora */ }

  try {
    await setDoc(doc(db, "usuarios", usuarioAtual.uid, "despensa", "atual"), {
      itens,
      atualizadoEm: serverTimestamp(),
    });
  } catch (erro) {
    console.error(erro);
  }

}

window.limparDespensa = function () {
  const campo = document.getElementById("ingredientes");
  if (campo) {
    campo.value = "";
    campo.focus();
  }
  salvarDespensa([]);
};


// ================= ILUSTRAÇÃO LOCAL (SVG, sem nenhuma imagem de rede) =================
// Cada categoria tem uma cor e um emoji. O emoji é texto Unicode, desenhado
// pelo próprio navegador — não é uma imagem baixada de lugar nenhum.
const CATEGORIA_VISUAL = {
  "Carnes":                      { emoji: "🥩", cor: "#B3492F" },
  "Aves":                        { emoji: "🍗", cor: "#D9A62E" },
  "Peixes e frutos do mar":      { emoji: "🐟", cor: "#213B29" },
  "Massas":                      { emoji: "🍝", cor: "#B4841E" },
  "Acompanhamentos":             { emoji: "🍚", cor: "#9BAE8D" },
  "Vegetariano":                 { emoji: "🥦", cor: "#16281C" },
  "Café da manhã":                { emoji: "🍳", cor: "#D9A62E" },
  "Salgados":                    { emoji: "🥟", cor: "#B4841E" },
  "Sobremesas":                  { emoji: "🍰", cor: "#B3492F" },
  "Sopas e caldos":              { emoji: "🍲", cor: "#213B29" },
};

function gerarIlustracaoSvg(categoria) {
  const visual = CATEGORIA_VISUAL[categoria] || { emoji: "🍽️", cor: "#54594C" };
  return `
    <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${categoria}">
      <rect width="400" height="300" fill="${visual.cor}"></rect>
      <text x="200" y="168" font-size="110" text-anchor="middle" dominant-baseline="middle">${visual.emoji}</text>
    </svg>
  `;
}


// ================= BANCO DE RECEITAS LOCAL (sem nenhuma API) =================
// Escrito à mão, direto em português — não depende de tradução nem de
// nenhum serviço externo. Lote 1 de 30 receitas (a meta são 100; os
// próximos lotes seguem depois, adicionando itens neste mesmo array).
const RECEITAS = [
  {
    id: "r001", titulo: "Feijoada simplificada", categoria: "Carnes", regiao: "Rio de Janeiro",
    porcoes: 6, tempoPreparo: "1h30",
    ingredientes: [
      { nome: "feijão preto", medida: "500 g" },
      { nome: "carne seca dessalgada", medida: "200 g" },
      { nome: "costelinha de porco", medida: "200 g" },
      { nome: "linguiça calabresa", medida: "150 g" },
      { nome: "bacon", medida: "100 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "4 dentes" },
      { nome: "folha de louro", medida: "2 unidades" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Deixe o feijão de molho de um dia para o outro.",
      "Cozinhe o feijão na panela de pressão com as folhas de louro até ficar macio.",
      "Em outra panela, cozinhe a carne seca, a costelinha, a linguiça e o bacon até ficarem macios.",
      "Refogue a cebola e o alho no azeite até dourar.",
      "Junte as carnes cozidas ao feijão, acrescente o refogado e deixe apurar por 20 minutos.",
      "Ajuste o sal e a pimenta e sirva com arroz branco e farofa.",
    ],
  },
  {
    id: "r002", titulo: "Picadinho de carne com arroz", categoria: "Carnes",
    porcoes: 4, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "carne bovina em cubos", medida: "500 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "tomate", medida: "2 unidades" },
      { nome: "pimentão", medida: "1 unidade" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
      { nome: "arroz branco", medida: "2 xícaras" },
    ],
    modoPreparo: [
      "Tempere a carne com sal e pimenta.",
      "Doure a carne no óleo em fogo alto, em porções, e reserve.",
      "No mesmo óleo, refogue cebola, alho, tomate e pimentão.",
      "Volte a carne para a panela, adicione um pouco de água e cozinhe em fogo baixo até ficar macia.",
      "Sirva com arroz branco.",
    ],
  },
  {
    id: "r003", titulo: "Carne de panela com batatas", categoria: "Carnes",
    porcoes: 4, tempoPreparo: "1h30",
    ingredientes: [
      { nome: "carne bovina para cozinhar", medida: "800 g" },
      { nome: "batata", medida: "4 unidades" },
      { nome: "cenoura", medida: "2 unidades" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "extrato de tomate", medida: "2 colheres de sopa" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere a carne com sal, pimenta e alho amassado.",
      "Doure a carne inteira no óleo, em fogo alto.",
      "Adicione a cebola picada, o extrato de tomate e água até cobrir a carne.",
      "Cozinhe em fogo baixo, com a panela tampada, até a carne ficar macia.",
      "Junte a batata e a cenoura em pedaços e cozinhe até ficarem macias.",
      "Corte a carne em fatias e sirva com o molho.",
    ],
  },
  {
    id: "r004", titulo: "Escondidinho de carne moída", categoria: "Carnes",
    porcoes: 4, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "carne moída", medida: "500 g" },
      { nome: "batata", medida: "6 unidades" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "queijo mussarela", medida: "150 g" },
      { nome: "manteiga", medida: "2 colheres de sopa" },
      { nome: "leite", medida: "1/2 xícara" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe as batatas até ficarem macias e amasse com manteiga, leite e sal, formando um purê.",
      "Refogue a cebola e o alho, junte a carne moída e tempere com sal e pimenta até dourar.",
      "Em um refratário, coloque metade do purê, depois a carne, e cubra com o restante do purê.",
      "Polvilhe o queijo por cima e leve ao forno até derreter e dourar.",
    ],
  },
  {
    id: "r005", titulo: "Strogonoff de frango", categoria: "Aves",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "peito de frango em tiras", medida: "500 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "champignon", medida: "100 g" },
      { nome: "extrato de tomate", medida: "2 colheres de sopa" },
      { nome: "creme de leite", medida: "1 lata" },
      { nome: "ketchup", medida: "1 colher de sopa" },
      { nome: "mostarda", medida: "1 colher de chá" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o frango com sal e pimenta e doure no óleo.",
      "Adicione cebola e alho e refogue até murchar.",
      "Junte o champignon, o extrato de tomate, o ketchup e a mostarda.",
      "Acrescente o creme de leite e cozinhe em fogo baixo por alguns minutos, sem ferver muito.",
      "Sirva com arroz branco e batata palha.",
    ],
  },
  {
    id: "r006", titulo: "Frango grelhado com legumes", categoria: "Aves",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "peito de frango", medida: "4 unidades" },
      { nome: "abobrinha", medida: "1 unidade" },
      { nome: "cenoura", medida: "1 unidade" },
      { nome: "brócolis", medida: "1 xícara" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o frango com sal, pimenta e alho e grelhe dos dois lados até dourar e cozinhar por dentro.",
      "Corte os legumes e refogue no azeite até ficarem macios, mas ainda firmes.",
      "Sirva o frango grelhado acompanhado dos legumes.",
    ],
  },
  {
    id: "r007", titulo: "Canja de galinha", categoria: "Sopas e caldos",
    porcoes: 4, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "frango em pedaços", medida: "500 g" },
      { nome: "arroz", medida: "1/2 xícara" },
      { nome: "cenoura", medida: "1 unidade" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "salsinha", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o frango em água até ficar macio, reservando o caldo.",
      "Desfie o frango e volte ao caldo junto com cebola, alho e cenoura picada.",
      "Adicione o arroz e cozinhe até ficar macio, ajustando o sal.",
      "Finalize com salsinha picada e sirva quente.",
    ],
  },
  {
    id: "r008", titulo: "Galinhada", categoria: "Aves", regiao: "Minas Gerais",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "frango em pedaços", medida: "800 g" },
      { nome: "arroz", medida: "2 xícaras" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "açafrão ou colorau", medida: "1 colher de chá" },
      { nome: "ervilha", medida: "1/2 xícara" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o frango com sal, pimenta e alho.",
      "Doure o frango no óleo, retire e reserve.",
      "No mesmo óleo, refogue cebola e alho, volte o frango e adicione o açafrão.",
      "Junte o arroz, misture bem e adicione água quente até cobrir.",
      "Cozinhe em fogo baixo até o arroz ficar macio, adicionando a ervilha no final.",
    ],
  },
  {
    id: "r009", titulo: "Frango com quiabo", categoria: "Aves", regiao: "Minas Gerais",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "frango em pedaços", medida: "800 g" },
      { nome: "quiabo", medida: "300 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "tomate", medida: "1 unidade" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Corte o quiabo em rodelas e refogue rapidamente no óleo até perder o \"baba\", reserve.",
      "Tempere o frango com sal, pimenta e limão, e doure no óleo.",
      "Adicione cebola, alho e tomate e refogue até formar um molho.",
      "Cozinhe o frango até ficar macio e junte o quiabo nos últimos minutos.",
    ],
  },
  {
    id: "r010", titulo: "Moqueca de peixe", categoria: "Peixes e frutos do mar", regiao: "Bahia",
    porcoes: 4, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "filé de peixe branco", medida: "600 g" },
      { nome: "tomate", medida: "2 unidades" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "pimentão", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "leite de coco", medida: "200 ml" },
      { nome: "azeite de dendê", medida: "2 colheres de sopa" },
      { nome: "coentro", medida: "1 colher de sopa" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o peixe com sal, pimenta, alho e limão e deixe marinando.",
      "Em uma panela de barro ou panela larga, faça camadas de cebola, tomate e pimentão fatiados.",
      "Coloque o peixe por cima e cubra com mais tomate, cebola e pimentão.",
      "Adicione o leite de coco e o azeite de dendê.",
      "Cozinhe em fogo médio, sem mexer muito, até o peixe cozinhar.",
      "Finalize com coentro picado e sirva com arroz branco e pirão.",
    ],
  },
  {
    id: "r011", titulo: "Peixe frito à brasileira", categoria: "Peixes e frutos do mar",
    porcoes: 4, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "filé de peixe", medida: "600 g" },
      { nome: "farinha de trigo", medida: "1 xícara" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o peixe com sal, pimenta, alho e limão e deixe descansar por 15 minutos.",
      "Passe os filés na farinha de trigo, cobrindo bem.",
      "Frite em óleo quente até dourar dos dois lados.",
      "Escorra em papel toalha e sirva com arroz e salada.",
    ],
  },
  {
    id: "r012", titulo: "Bobó de camarão", categoria: "Peixes e frutos do mar", regiao: "Bahia",
    porcoes: 4, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "camarão limpo", medida: "500 g" },
      { nome: "mandioca", medida: "500 g" },
      { nome: "leite de coco", medida: "200 ml" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "tomate", medida: "1 unidade" },
      { nome: "pimentão", medida: "1 unidade" },
      { nome: "azeite de dendê", medida: "1 colher de sopa" },
      { nome: "coentro", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe a mandioca até ficar bem macia e amasse até formar um purê, reservando a água do cozimento.",
      "Tempere o camarão com sal, pimenta e alho.",
      "Refogue cebola, alho, tomate e pimentão, adicione o camarão e cozinhe rapidamente.",
      "Junte o purê de mandioca, o leite de coco e o azeite de dendê, mexendo até engrossar.",
      "Finalize com coentro e sirva com arroz branco.",
    ],
  },
  {
    id: "r013", titulo: "Macarrão à bolonhesa", categoria: "Massas",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "macarrão espaguete", medida: "500 g" },
      { nome: "carne moída", medida: "400 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "molho de tomate", medida: "500 ml" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "orégano", medida: "1 colher de chá" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o macarrão em água fervente com sal até ficar al dente.",
      "Refogue cebola e alho no azeite, adicione a carne moída e cozinhe até dourar.",
      "Junte o molho de tomate e o orégano e cozinhe em fogo baixo por 15 minutos.",
      "Misture o molho ao macarrão escorrido e sirva.",
    ],
  },
  {
    id: "r014", titulo: "Lasanha de carne", categoria: "Massas",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "massa de lasanha", medida: "250 g" },
      { nome: "carne moída", medida: "400 g" },
      { nome: "molho de tomate", medida: "500 ml" },
      { nome: "queijo mussarela", medida: "300 g" },
      { nome: "molho branco", medida: "300 ml" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "queijo parmesão ralado", medida: "50 g" },
    ],
    modoPreparo: [
      "Refogue cebola e alho, adicione a carne moída e depois o molho de tomate, cozinhando por 15 minutos.",
      "Em um refratário, monte camadas alternando massa, molho de carne, molho branco e queijo mussarela.",
      "Finalize com queijo parmesão por cima.",
      "Leve ao forno preaquecido até gratinar e dourar por cima.",
    ],
  },
  {
    id: "r015", titulo: "Nhoque de batata", categoria: "Massas",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "batata", medida: "800 g" },
      { nome: "farinha de trigo", medida: "2 xícaras" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "queijo parmesão ralado", medida: "50 g" },
      { nome: "sal", medida: "a gosto" },
      { nome: "molho de tomate", medida: "500 ml" },
    ],
    modoPreparo: [
      "Cozinhe as batatas até ficarem bem macias e amasse ainda quentes.",
      "Misture o ovo, o queijo, o sal e a farinha aos poucos, até formar uma massa macia.",
      "Modele os nhoques e cozinhe em água fervente até subirem à superfície.",
      "Sirva com molho de tomate quente.",
    ],
  },
  {
    id: "r016", titulo: "Arroz e feijão simples", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "arroz", medida: "2 xícaras" },
      { nome: "feijão carioca", medida: "2 xícaras" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o feijão na panela de pressão até ficar macio.",
      "Refogue metade da cebola e do alho no óleo, junte o feijão cozido e o sal.",
      "Em outra panela, refogue o restante da cebola e do alho, adicione o arroz e água, e cozinhe até secar.",
      "Sirva o arroz com o feijão.",
    ],
  },
  {
    id: "r017", titulo: "Farofa de bacon", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "farinha de mandioca", medida: "2 xícaras" },
      { nome: "bacon em cubos", medida: "150 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "manteiga", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Frite o bacon até ficar crocante e reserve a gordura.",
      "Na mesma panela, com a manteiga, refogue a cebola até dourar.",
      "Junte a farinha de mandioca aos poucos, mexendo sempre, até dourar levemente.",
      "Volte o bacon, ajuste o sal e sirva.",
    ],
  },
  {
    id: "r018", titulo: "Baião de dois", categoria: "Acompanhamentos", regiao: "Nordeste",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "arroz", medida: "2 xícaras" },
      { nome: "feijão de corda", medida: "2 xícaras" },
      { nome: "queijo coalho em cubos", medida: "150 g" },
      { nome: "carne seca dessalgada", medida: "150 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "coentro", medida: "1 colher de sopa" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o feijão de corda até ficar macio.",
      "Refogue a carne seca desfiada com cebola e alho no óleo.",
      "Junte o arroz e o feijão cozido, adicionando água quente e cozinhando até secar.",
      "Misture o queijo coalho e o coentro no final e sirva quente.",
    ],
  },
  {
    id: "r019", titulo: "Feijão tropeiro", categoria: "Acompanhamentos", regiao: "Minas Gerais",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "feijão carioca cozido", medida: "3 xícaras" },
      { nome: "bacon em cubos", medida: "150 g" },
      { nome: "linguiça calabresa", medida: "150 g" },
      { nome: "ovo", medida: "3 unidades" },
      { nome: "farinha de mandioca", medida: "1 xícara" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "couve", medida: "1 xícara" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Frite o bacon e a linguiça até dourar, reserve.",
      "Refogue cebola e alho na mesma gordura, adicione os ovos mexidos e reserve.",
      "Junte o feijão escorrido, o bacon, a linguiça e os ovos, misturando bem.",
      "Adicione a farinha de mandioca aos poucos, ajustando a textura.",
      "Finalize com a couve refogada por cima.",
    ],
  },
  {
    id: "r020", titulo: "Salada de maionese", categoria: "Vegetariano",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "batata", medida: "4 unidades" },
      { nome: "cenoura", medida: "2 unidades" },
      { nome: "ervilha", medida: "1/2 xícara" },
      { nome: "maionese", medida: "1 xícara" },
      { nome: "ovo cozido", medida: "2 unidades" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe a batata e a cenoura em cubos até ficarem macias, mas firmes.",
      "Escorra bem e deixe esfriar.",
      "Misture com a ervilha, o ovo picado e a maionese.",
      "Ajuste o sal e leve à geladeira antes de servir.",
    ],
  },
  {
    id: "r021", titulo: "Legumes refogados", categoria: "Vegetariano",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "abobrinha", medida: "1 unidade" },
      { nome: "cenoura", medida: "1 unidade" },
      { nome: "brócolis", medida: "1 xícara" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Corte os legumes em pedaços do mesmo tamanho.",
      "Refogue cebola e alho no azeite até murchar.",
      "Junte os legumes mais firmes primeiro (cenoura) e depois os mais macios (abobrinha, brócolis).",
      "Tempere com sal e pimenta e cozinhe até ficarem macios, mas ainda com textura.",
    ],
  },
  {
    id: "r022", titulo: "Omelete simples", categoria: "Café da manhã",
    porcoes: 1, tempoPreparo: "10 min",
    ingredientes: [
      { nome: "ovo", medida: "3 unidades" },
      { nome: "queijo mussarela", medida: "50 g" },
      { nome: "cebolinha", medida: "1 colher de sopa" },
      { nome: "manteiga", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Bata os ovos com sal e pimenta.",
      "Derreta a manteiga em uma frigideira antiaderente.",
      "Despeje os ovos batidos e deixe cozinhar em fogo baixo.",
      "Adicione o queijo e a cebolinha, dobre a omelete ao meio e sirva.",
    ],
  },
  {
    id: "r023", titulo: "Tapioca recheada", categoria: "Café da manhã", regiao: "Nordeste",
    porcoes: 1, tempoPreparo: "10 min",
    ingredientes: [
      { nome: "goma de tapioca", medida: "1 xícara" },
      { nome: "queijo coalho fatiado", medida: "100 g" },
      { nome: "manteiga", medida: "1 colher de chá" },
    ],
    modoPreparo: [
      "Peneire a goma de tapioca em uma frigideira antiaderente quente, formando uma camada fina.",
      "Deixe firmar por cerca de 1 minuto e vire com cuidado.",
      "Recheie com o queijo coalho e dobre ao meio.",
      "Sirva quente.",
    ],
  },
  {
    id: "r024", titulo: "Pão de queijo", categoria: "Café da manhã", regiao: "Minas Gerais",
    porcoes: 20, tempoPreparo: "45 min",
    ingredientes: [
      { nome: "polvilho azedo", medida: "500 g" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "óleo", medida: "1/2 xícara" },
      { nome: "ovo", medida: "2 unidades" },
      { nome: "queijo minas ralado", medida: "200 g" },
      { nome: "sal", medida: "1 colher de chá" },
    ],
    modoPreparo: [
      "Ferva o leite com o óleo e o sal e despeje sobre o polvilho, misturando bem.",
      "Deixe esfriar um pouco e adicione os ovos e o queijo, sovando até formar uma massa homogênea.",
      "Modele bolinhas e disponha em uma assadeira.",
      "Asse em forno preaquecido até crescerem e dourarem por fora.",
    ],
  },
  {
    id: "r025", titulo: "Coxinha de frango", categoria: "Salgados",
    porcoes: 15, tempoPreparo: "1h",
    ingredientes: [
      { nome: "peito de frango cozido e desfiado", medida: "300 g" },
      { nome: "caldo de galinha", medida: "3 xícaras" },
      { nome: "farinha de trigo", medida: "3 xícaras" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "manteiga", medida: "2 colheres de sopa" },
      { nome: "farinha de rosca", medida: "1 xícara" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Refogue a cebola na manteiga, junte o frango desfiado e tempere.",
      "Leve o caldo de galinha ao fogo, adicione a farinha de trigo de uma vez e mexa até desgrudar da panela, formando a massa.",
      "Deixe a massa esfriar, modele as coxinhas recheadas com o frango.",
      "Passe no ovo batido e depois na farinha de rosca.",
      "Frite em óleo quente até dourar.",
    ],
  },
  {
    id: "r026", titulo: "Pastel de carne", categoria: "Salgados",
    porcoes: 20, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "massa de pastel", medida: "20 unidades" },
      { nome: "carne moída", medida: "400 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Refogue a cebola e o alho, junte a carne moída e tempere, cozinhando até secar bem.",
      "Deixe o recheio esfriar antes de usar.",
      "Recheie os discos de massa de pastel, feche bem as bordas.",
      "Frite em óleo quente até dourar dos dois lados.",
    ],
  },
  {
    id: "r027", titulo: "Brigadeiro", categoria: "Sobremesas",
    porcoes: 20, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "leite condensado", medida: "1 lata" },
      { nome: "chocolate em pó", medida: "3 colheres de sopa" },
      { nome: "manteiga", medida: "1 colher de sopa" },
      { nome: "chocolate granulado", medida: "1 xícara" },
    ],
    modoPreparo: [
      "Misture o leite condensado, o chocolate em pó e a manteiga em uma panela.",
      "Cozinhe em fogo baixo, mexendo sempre, até desgrudar do fundo da panela.",
      "Deixe esfriar, modele bolinhas e passe no chocolate granulado.",
    ],
  },
  {
    id: "r028", titulo: "Beijinho", categoria: "Sobremesas",
    porcoes: 20, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "leite condensado", medida: "1 lata" },
      { nome: "coco ralado", medida: "1 xícara" },
      { nome: "manteiga", medida: "1 colher de sopa" },
      { nome: "cravo", medida: "20 unidades" },
    ],
    modoPreparo: [
      "Misture o leite condensado, o coco ralado e a manteiga em uma panela.",
      "Cozinhe em fogo baixo, mexendo sempre, até desgrudar do fundo da panela.",
      "Deixe esfriar, modele bolinhas, passe no coco ralado e finalize com um cravo em cada uma.",
    ],
  },
  {
    id: "r029", titulo: "Bolo de fubá", categoria: "Sobremesas",
    porcoes: 10, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "fubá", medida: "1 xícara" },
      { nome: "farinha de trigo", medida: "1 xícara" },
      { nome: "açúcar", medida: "2 xícaras" },
      { nome: "ovo", medida: "3 unidades" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "óleo", medida: "1/2 xícara" },
      { nome: "queijo ralado", medida: "1/2 xícara" },
      { nome: "fermento em pó", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Bata no liquidificador os ovos, o leite, o óleo e o açúcar.",
      "Adicione o fubá, a farinha e o queijo, batendo até ficar homogêneo.",
      "Por último, misture o fermento delicadamente.",
      "Despeje em uma forma untada e asse em forno preaquecido até dourar.",
    ],
  },
  {
    id: "r030", titulo: "Pudim de leite condensado", categoria: "Sobremesas",
    porcoes: 8, tempoPreparo: "1h (+ geladeira)",
    ingredientes: [
      { nome: "leite condensado", medida: "1 lata" },
      { nome: "leite", medida: "1 lata (usando a lata do leite condensado como medida)" },
      { nome: "ovo", medida: "3 unidades" },
      { nome: "açúcar", medida: "1 xícara" },
    ],
    modoPreparo: [
      "Derreta o açúcar em uma panela até formar uma calda dourada e forre uma forma com ela.",
      "Bata no liquidificador o leite condensado, o leite e os ovos.",
      "Despeje sobre a calda na forma.",
      "Asse em banho-maria em forno preaquecido até firmar.",
      "Deixe esfriar e leve à geladeira antes de desenformar.",
    ],
  },

  // ---- Lote 2 (r031 a r060) ----
  {
    id: "r031", titulo: "Bife à parmegiana", categoria: "Carnes",
    porcoes: 4, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "bife bovino", medida: "4 unidades" },
      { nome: "ovo", medida: "2 unidades" },
      { nome: "farinha de rosca", medida: "1 xícara" },
      { nome: "farinha de trigo", medida: "1/2 xícara" },
      { nome: "molho de tomate", medida: "300 ml" },
      { nome: "queijo mussarela", medida: "150 g" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere os bifes com sal e pimenta.",
      "Passe cada bife na farinha de trigo, depois no ovo batido e por fim na farinha de rosca.",
      "Frite os bifes empanados até dourarem dos dois lados e escorra em papel toalha.",
      "Arrume os bifes em um refratário, cubra com o molho de tomate e o queijo.",
      "Leve ao forno preaquecido até o queijo derreter e gratinar.",
    ],
  },
  {
    id: "r032", titulo: "Costela assada", categoria: "Carnes", regiao: "Rio Grande do Sul",
    porcoes: 6, tempoPreparo: "3h",
    ingredientes: [
      { nome: "costela bovina", medida: "1.5 kg" },
      { nome: "alho", medida: "4 dentes" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "louro", medida: "2 unidades" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere a costela com sal, pimenta e alho amassado, e deixe descansar por pelo menos 1 hora.",
      "Coloque a costela em uma assadeira com a cebola e o louro, cubra com papel alumínio.",
      "Asse em forno baixo por várias horas, até a carne ficar bem macia e soltando do osso.",
      "Retire o papel alumínio no final e deixe dourar por mais alguns minutos.",
    ],
  },
  {
    id: "r033", titulo: "Panqueca de carne", categoria: "Carnes",
    porcoes: 4, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "carne moída", medida: "300 g" },
      { nome: "farinha de trigo", medida: "1 xícara" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "molho de tomate", medida: "300 ml" },
      { nome: "queijo mussarela", medida: "100 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Bata no liquidificador a farinha, o leite, o ovo e o sal, formando a massa da panqueca.",
      "Frite pequenas porções da massa numa frigideira antiaderente, dos dois lados, formando discos finos.",
      "Refogue a cebola e a carne moída, tempere e cozinhe até dourar, formando o recheio.",
      "Recheie cada panqueca, enrole e arrume em um refratário.",
      "Cubra com molho de tomate e queijo, e leve ao forno até gratinar.",
    ],
  },
  {
    id: "r034", titulo: "Rocambole de carne moída", categoria: "Carnes",
    porcoes: 4, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "carne moída", medida: "600 g" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "farinha de rosca", medida: "1/2 xícara" },
      { nome: "presunto fatiado", medida: "100 g" },
      { nome: "queijo mussarela fatiado", medida: "100 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Misture a carne moída, o ovo, a farinha de rosca, a cebola, o alho, o sal e a pimenta.",
      "Abra a massa de carne sobre um plástico, formando um retângulo.",
      "Distribua o presunto e o queijo por cima e enrole com a ajuda do plástico, como um rocambole.",
      "Leve ao forno preaquecido até a carne cozinhar por completo e dourar por fora.",
      "Deixe descansar alguns minutos antes de fatiar.",
    ],
  },
  {
    id: "r035", titulo: "Carne de sol com jerimum", categoria: "Carnes", regiao: "Nordeste",
    porcoes: 4, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "carne de sol dessalgada", medida: "500 g" },
      { nome: "abóbora", medida: "500 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "coentro", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Cozinhe a carne de sol até ficar macia e desfie ou corte em pedaços.",
      "Cozinhe a abóbora até ficar macia e amasse levemente.",
      "Refogue a cebola e o alho no óleo, junte a carne e a abóbora e misture bem.",
      "Finalize com coentro picado e sirva quente.",
    ],
  },
  {
    id: "r036", titulo: "Frango à passarinho", categoria: "Aves",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "frango em pedaços pequenos", medida: "1 kg" },
      { nome: "alho", medida: "4 dentes" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "farinha de trigo", medida: "1/2 xícara" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o frango com sal, pimenta, alho e limão e deixe marinando por 30 minutos.",
      "Passe os pedaços de frango levemente na farinha de trigo.",
      "Frite em óleo quente até ficarem bem dourados e crocantes por fora.",
      "Escorra em papel toalha e sirva com limão.",
    ],
  },
  {
    id: "r037", titulo: "Frango xadrez", categoria: "Aves",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "peito de frango em cubos", medida: "500 g" },
      { nome: "pimentão", medida: "1 unidade" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "molho de soja", medida: "3 colheres de sopa" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "gengibre", medida: "1 colher de chá" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "amendoim torrado", medida: "1/2 xícara" },
    ],
    modoPreparo: [
      "Tempere o frango com o molho de soja e deixe descansar por alguns minutos.",
      "Refogue o alho e o gengibre no óleo, adicione o frango e cozinhe até dourar.",
      "Junte a cebola e o pimentão em cubos e refogue até ficarem macios, mas ainda firmes.",
      "Finalize com o amendoim torrado por cima e sirva com arroz.",
    ],
  },
  {
    id: "r038", titulo: "Empadão de frango", categoria: "Aves",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "peito de frango cozido e desfiado", medida: "400 g" },
      { nome: "farinha de trigo", medida: "3 xícaras" },
      { nome: "manteiga", medida: "200 g" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "milho", medida: "1/2 xícara" },
      { nome: "ervilha", medida: "1/2 xícara" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Misture a farinha, a manteiga gelada e uma pitada de sal até formar uma farofa, adicione água aos poucos até formar uma massa lisa.",
      "Refogue a cebola, junte o frango desfiado, o milho e a ervilha, temperando bem.",
      "Forre um refratário com parte da massa e coloque o recheio por cima.",
      "Cubra com o restante da massa, pincele com ovo batido e faça furinhos.",
      "Asse em forno preaquecido até a massa dourar.",
    ],
  },
  {
    id: "r039", titulo: "Frango assado com batatas", categoria: "Aves",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "frango inteiro em pedaços", medida: "1.2 kg" },
      { nome: "batata", medida: "5 unidades" },
      { nome: "alho", medida: "4 dentes" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "azeite", medida: "3 colheres de sopa" },
      { nome: "alecrim", medida: "1 colher de chá" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o frango com sal, pimenta, alho, limão e alecrim, e deixe marinando por 30 minutos.",
      "Corte as batatas em pedaços grandes e misture com azeite e sal.",
      "Arrume o frango e as batatas em uma assadeira.",
      "Asse em forno preaquecido até o frango e as batatas dourarem por completo.",
    ],
  },
  {
    id: "r040", titulo: "Frango ao curry", categoria: "Aves",
    porcoes: 4, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "peito de frango em cubos", medida: "500 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "leite de coco", medida: "200 ml" },
      { nome: "curry", medida: "1 colher de sopa" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o frango com sal e refogue no óleo até dourar.",
      "Adicione a cebola e o alho e refogue até murchar.",
      "Junte o curry e misture bem por um minuto para liberar o aroma.",
      "Acrescente o leite de coco e cozinhe em fogo baixo até engrossar levemente.",
      "Sirva com arroz branco.",
    ],
  },
  {
    id: "r041", titulo: "Casquinha de siri", categoria: "Peixes e frutos do mar", regiao: "Bahia",
    porcoes: 6, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "carne de siri", medida: "400 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "tomate", medida: "1 unidade" },
      { nome: "leite de coco", medida: "100 ml" },
      { nome: "farinha de rosca", medida: "3 colheres de sopa" },
      { nome: "azeite de dendê", medida: "1 colher de sopa" },
      { nome: "coentro", medida: "1 colher de sopa" },
      { nome: "limão", medida: "1 unidade" },
    ],
    modoPreparo: [
      "Tempere a carne de siri com limão e reserve.",
      "Refogue cebola, alho e tomate no azeite de dendê.",
      "Junte a carne de siri e o leite de coco, cozinhando por alguns minutos.",
      "Adicione a farinha de rosca aos poucos até dar liga, sem ficar seco demais.",
      "Finalize com coentro e sirva em casquinhas ou num refratário pequeno.",
    ],
  },
  {
    id: "r042", titulo: "Camarão à baiana", categoria: "Peixes e frutos do mar", regiao: "Bahia",
    porcoes: 4, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "camarão limpo", medida: "500 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "tomate", medida: "2 unidades" },
      { nome: "pimentão", medida: "1 unidade" },
      { nome: "leite de coco", medida: "200 ml" },
      { nome: "azeite de dendê", medida: "2 colheres de sopa" },
      { nome: "coentro", medida: "1 colher de sopa" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o camarão com limão e sal.",
      "Refogue cebola, alho, tomate e pimentão no azeite de dendê.",
      "Junte o camarão e cozinhe rapidamente, sem deixar ressecar.",
      "Adicione o leite de coco e cozinhe por mais alguns minutos.",
      "Finalize com coentro e sirva com arroz branco.",
    ],
  },
  {
    id: "r043", titulo: "Bacalhau à brás", categoria: "Peixes e frutos do mar",
    porcoes: 4, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "bacalhau dessalgado e desfiado", medida: "400 g" },
      { nome: "batata palha", medida: "2 xícaras" },
      { nome: "ovo", medida: "5 unidades" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "azeite", medida: "3 colheres de sopa" },
      { nome: "salsinha", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Refogue a cebola e o alho no azeite até dourar.",
      "Junte o bacalhau desfiado e refogue por alguns minutos.",
      "Adicione os ovos batidos e mexa em fogo baixo até começarem a cozinhar, como um ovo mexido cremoso.",
      "Misture a batata palha delicadamente no final, para manter a crocância.",
      "Finalize com salsinha picada e sirva imediatamente.",
    ],
  },
  {
    id: "r044", titulo: "Peixe ao molho de coco", categoria: "Peixes e frutos do mar",
    porcoes: 4, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "filé de peixe branco", medida: "600 g" },
      { nome: "leite de coco", medida: "200 ml" },
      { nome: "tomate", medida: "1 unidade" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "coentro", medida: "1 colher de sopa" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o peixe com sal e limão.",
      "Refogue a cebola, o alho e o tomate no azeite.",
      "Adicione o peixe e cozinhe por alguns minutos de cada lado.",
      "Junte o leite de coco e cozinhe em fogo baixo até o peixe ficar macio.",
      "Finalize com coentro e sirva com arroz branco.",
    ],
  },
  {
    id: "r045", titulo: "Macarrão alho e óleo", categoria: "Massas",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "macarrão espaguete", medida: "500 g" },
      { nome: "alho", medida: "6 dentes" },
      { nome: "azeite", medida: "4 colheres de sopa" },
      { nome: "pimenta calabresa", medida: "1 colher de chá" },
      { nome: "salsinha", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o macarrão em água fervente com sal até ficar al dente.",
      "Doure o alho fatiado no azeite, em fogo baixo, sem deixar queimar.",
      "Junte a pimenta calabresa e o macarrão escorrido, misturando bem.",
      "Finalize com salsinha picada e sirva na hora.",
    ],
  },
  {
    id: "r046", titulo: "Panqueca de espinafre e ricota", categoria: "Massas",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "farinha de trigo", medida: "1 xícara" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "espinafre", medida: "1 xícara" },
      { nome: "ricota", medida: "200 g" },
      { nome: "molho de tomate", medida: "300 ml" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Bata no liquidificador a farinha, o leite, o ovo e o sal, formando a massa.",
      "Frite pequenas porções da massa numa frigideira antiaderente, formando discos finos.",
      "Refogue o espinafre rapidamente e misture com a ricota amassada, temperando com sal.",
      "Recheie as panquecas, enrole e arrume em um refratário.",
      "Cubra com molho de tomate e leve ao forno até aquecer bem.",
    ],
  },
  {
    id: "r047", titulo: "Talharim ao molho branco", categoria: "Massas",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "macarrão talharim", medida: "500 g" },
      { nome: "manteiga", medida: "2 colheres de sopa" },
      { nome: "farinha de trigo", medida: "2 colheres de sopa" },
      { nome: "leite", medida: "2 xícaras" },
      { nome: "queijo parmesão ralado", medida: "50 g" },
      { nome: "noz-moscada", medida: "a gosto" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o talharim em água fervente com sal até ficar al dente.",
      "Derreta a manteiga, junte a farinha de trigo e mexa bem por um minuto.",
      "Adicione o leite aos poucos, mexendo sempre, até engrossar e formar o molho branco.",
      "Tempere com noz-moscada e sal, e finalize com o queijo parmesão.",
      "Misture o molho ao talharim escorrido e sirva.",
    ],
  },
  {
    id: "r048", titulo: "Purê de batata", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "batata", medida: "6 unidades" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "manteiga", medida: "2 colheres de sopa" },
      { nome: "noz-moscada", medida: "a gosto" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe as batatas em água com sal até ficarem bem macias.",
      "Escorra e amasse ainda quentes, até formar um purê liso.",
      "Adicione a manteiga e o leite aos poucos, mexendo até ficar cremoso.",
      "Tempere com noz-moscada e sal e sirva quente.",
    ],
  },
  {
    id: "r049", titulo: "Arroz à grega", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "arroz", medida: "2 xícaras" },
      { nome: "cenoura", medida: "1 unidade" },
      { nome: "ervilha", medida: "1/2 xícara" },
      { nome: "milho", medida: "1/2 xícara" },
      { nome: "pimentão", medida: "1 unidade" },
      { nome: "passas", medida: "2 colheres de sopa" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Refogue a cebola no óleo, junte o arroz e refogue por mais um minuto.",
      "Adicione água quente e sal e cozinhe até o arroz ficar quase pronto.",
      "Junte a cenoura em cubos pequenos, o pimentão, o milho e a ervilha.",
      "Cozinhe até o arroz e os legumes ficarem macios, finalizando com as passas.",
    ],
  },
  {
    id: "r050", titulo: "Couve refogada", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "couve", medida: "1 maço" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Lave bem as folhas de couve, retire os talos e corte em tiras bem finas.",
      "Aqueça o azeite e doure o alho.",
      "Junte a couve e refogue rapidamente, em fogo alto, por poucos minutos.",
      "Tempere com sal e sirva na hora, para não perder a cor e a textura.",
    ],
  },
  {
    id: "r051", titulo: "Vinagrete", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "tomate", medida: "2 unidades" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "pimentão", medida: "1 unidade" },
      { nome: "vinagre", medida: "3 colheres de sopa" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Corte o tomate, a cebola e o pimentão em cubos bem pequenos.",
      "Misture tudo em uma tigela com o vinagre, o azeite e o sal.",
      "Deixe descansar na geladeira por pelo menos 15 minutos antes de servir, para os sabores se misturarem.",
    ],
  },
  {
    id: "r052", titulo: "Mandioca frita", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "mandioca", medida: "700 g" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe a mandioca em água com sal até ficar macia, mas ainda firme.",
      "Escorra bem e corte em pedaços do tamanho de palitos grossos.",
      "Frite em óleo quente até dourar e ficar crocante por fora.",
      "Escorra em papel toalha, tempere com sal e sirva quente.",
    ],
  },
  {
    id: "r053", titulo: "Salada de grão de bico", categoria: "Vegetariano",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "grão de bico cozido", medida: "2 xícaras" },
      { nome: "tomate", medida: "1 unidade" },
      { nome: "pepino", medida: "1 unidade" },
      { nome: "cebola roxa", medida: "1/2 unidade" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Escorra bem o grão de bico cozido e deixe esfriar.",
      "Corte o tomate, o pepino e a cebola roxa em cubos pequenos.",
      "Misture tudo com o grão de bico, o azeite, o limão e o sal.",
      "Leve à geladeira por alguns minutos antes de servir.",
    ],
  },
  {
    id: "r054", titulo: "Torta de legumes", categoria: "Vegetariano",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "farinha de trigo", medida: "2 xícaras" },
      { nome: "ovo", medida: "3 unidades" },
      { nome: "óleo", medida: "1/2 xícara" },
      { nome: "leite", medida: "1/2 xícara" },
      { nome: "cenoura", medida: "1 unidade" },
      { nome: "brócolis", medida: "1 xícara" },
      { nome: "milho", medida: "1/2 xícara" },
      { nome: "queijo ralado", medida: "1/2 xícara" },
      { nome: "fermento em pó", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Bata no liquidificador os ovos, o óleo, o leite e o sal.",
      "Misture com a farinha e o queijo até formar uma massa homogênea.",
      "Junte os legumes picados e o fermento, misturando delicadamente.",
      "Despeje em uma forma untada e asse em forno preaquecido até dourar por cima e firmar no meio.",
    ],
  },
  {
    id: "r055", titulo: "Abobrinha recheada", categoria: "Vegetariano",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "abobrinha", medida: "3 unidades" },
      { nome: "queijo mussarela", medida: "150 g" },
      { nome: "molho de tomate", medida: "200 ml" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "milho", medida: "1/2 xícara" },
      { nome: "azeite", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Corte as abobrinhas ao meio no sentido do comprimento e retire parte do miolo com uma colher.",
      "Refogue a cebola no azeite, junte o miolo picado e o milho, temperando com sal.",
      "Misture o refogado com o molho de tomate e recheie as abobrinhas.",
      "Cubra com queijo mussarela e leve ao forno até a abobrinha ficar macia e o queijo dourar.",
    ],
  },
  {
    id: "r056", titulo: "Cuscuz nordestino", categoria: "Café da manhã", regiao: "Nordeste",
    porcoes: 2, tempoPreparo: "15 min",
    ingredientes: [
      { nome: "farinha de milho para cuscuz", medida: "2 xícaras" },
      { nome: "água", medida: "1/2 xícara" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Umedeça a farinha de milho com a água e o sal, misturando com as mãos até ficar úmida, mas soltinha.",
      "Coloque a farinha numa cuscuzeira sobre água fervente, sem deixar a água tocar a farinha.",
      "Cozinhe no vapor por cerca de 15 a 20 minutos, até a farinha ficar cozida e translúcida.",
      "Desenforme ainda quente e sirva com manteiga, ovo ou leite de coco.",
    ],
  },
  {
    id: "r057", titulo: "Misto quente", categoria: "Café da manhã",
    porcoes: 1, tempoPreparo: "10 min",
    ingredientes: [
      { nome: "pão de forma", medida: "2 unidades" },
      { nome: "presunto", medida: "2 fatias" },
      { nome: "queijo mussarela", medida: "2 fatias" },
      { nome: "manteiga", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Monte o sanduíche com o presunto e o queijo entre as fatias de pão.",
      "Passe manteiga nas partes externas do pão.",
      "Grelhe numa frigideira ou sanduicheira até o pão dourar e o queijo derreter por dentro.",
    ],
  },
  {
    id: "r058", titulo: "Bolo de banana", categoria: "Sobremesas",
    porcoes: 10, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "banana", medida: "4 unidades" },
      { nome: "farinha de trigo", medida: "2 xícaras" },
      { nome: "açúcar", medida: "1 xícara" },
      { nome: "ovo", medida: "3 unidades" },
      { nome: "óleo", medida: "1/2 xícara" },
      { nome: "canela", medida: "1 colher de chá" },
      { nome: "fermento em pó", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Bata no liquidificador as bananas, os ovos, o óleo e o açúcar até ficar homogêneo.",
      "Misture com a farinha e a canela, e por último o fermento.",
      "Despeje em uma forma untada e enfeite com rodelas de banana por cima.",
      "Asse em forno preaquecido até dourar e assar por dentro.",
    ],
  },
  {
    id: "r059", titulo: "Bolo de chocolate", categoria: "Sobremesas",
    porcoes: 10, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "farinha de trigo", medida: "2 xícaras" },
      { nome: "chocolate em pó", medida: "1 xícara" },
      { nome: "açúcar", medida: "2 xícaras" },
      { nome: "ovo", medida: "3 unidades" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "óleo", medida: "1/2 xícara" },
      { nome: "fermento em pó", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Bata no liquidificador os ovos, o leite, o óleo e o açúcar.",
      "Adicione a farinha e o chocolate em pó, batendo até ficar homogêneo.",
      "Misture o fermento delicadamente por último.",
      "Despeje em uma forma untada e asse em forno preaquecido até dourar por cima.",
    ],
  },
  {
    id: "r060", titulo: "Mousse de maracujá", categoria: "Sobremesas",
    porcoes: 6, tempoPreparo: "20 min (+ geladeira)",
    ingredientes: [
      { nome: "leite condensado", medida: "1 lata" },
      { nome: "creme de leite", medida: "1 lata" },
      { nome: "suco de maracujá concentrado", medida: "1/2 xícara" },
    ],
    modoPreparo: [
      "Bata no liquidificador o leite condensado, o creme de leite e o suco de maracujá.",
      "Despeje em taças ou em um refratário grande.",
      "Leve à geladeira por pelo menos 3 horas antes de servir.",
    ],
  },
  // ---- Lote 3 (r061 a r100) ----
  {
    id: "r061", titulo: "Vaca atolada", categoria: "Carnes", regiao: "Minas Gerais",
    porcoes: 6, tempoPreparo: "1h30",
    ingredientes: [
      { nome: "costela bovina", medida: "1 kg" },
      { nome: "mandioca", medida: "500 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "tomate", medida: "1 unidade" },
      { nome: "cheiro-verde", medida: "1 colher de sopa" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere a costela com sal e pimenta e doure bem no óleo.",
      "Refogue a cebola, o alho e o tomate junto com a carne.",
      "Cubra com água e cozinhe em fogo baixo até a carne ficar bem macia.",
      "Junte a mandioca em pedaços e cozinhe até ela ficar macia e o caldo engrossar.",
      "Finalize com cheiro-verde picado.",
    ],
  },
  {
    id: "r062", titulo: "Carne louca", categoria: "Carnes",
    porcoes: 6, tempoPreparo: "1h",
    ingredientes: [
      { nome: "carne bovina para desfiar", medida: "600 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "pimentão", medida: "1 unidade" },
      { nome: "molho de tomate", medida: "200 ml" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe a carne em água até ficar bem macia e desfie com dois garfos.",
      "Refogue a cebola, o alho e o pimentão no óleo.",
      "Junte a carne desfiada e o molho de tomate, temperando com sal e pimenta.",
      "Cozinhe por mais alguns minutos até incorporar bem o molho.",
      "Sirva puro, com arroz ou em pão.",
    ],
  },
  {
    id: "r063", titulo: "Bife à cavalo", categoria: "Carnes",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "bife bovino", medida: "4 unidades" },
      { nome: "ovo", medida: "4 unidades" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere os bifes com sal, pimenta e alho.",
      "Frite os bifes no óleo até dourarem dos dois lados, no ponto desejado.",
      "Em outra frigideira, frite os ovos com a gema mole.",
      "Sirva cada bife com um ovo frito por cima.",
    ],
  },
  {
    id: "r064", titulo: "Carne de panela com mandioca", categoria: "Carnes",
    porcoes: 5, tempoPreparo: "1h30",
    ingredientes: [
      { nome: "carne bovina para cozinhar", medida: "700 g" },
      { nome: "mandioca", medida: "400 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "extrato de tomate", medida: "2 colheres de sopa" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere a carne com sal, pimenta e alho e doure inteira no óleo.",
      "Adicione a cebola e o extrato de tomate e refogue.",
      "Cubra com água e cozinhe em fogo baixo até a carne ficar macia.",
      "Junte a mandioca em pedaços e cozinhe até ela ficar macia.",
      "Fatie a carne e sirva com o molho.",
    ],
  },
  {
    id: "r065", titulo: "Almôndegas ao molho", categoria: "Carnes",
    porcoes: 5, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "carne moída", medida: "500 g" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "farinha de rosca", medida: "1/2 xícara" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "molho de tomate", medida: "400 ml" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Misture a carne moída, o ovo, a farinha de rosca, metade da cebola e do alho picados, sal e pimenta.",
      "Molde pequenas almôndegas e doure em um fio de óleo.",
      "Refogue o restante da cebola e do alho e junte o molho de tomate.",
      "Coloque as almôndegas no molho e cozinhe por 15 minutos em fogo baixo.",
    ],
  },
  {
    id: "r066", titulo: "Canjiquinha com frango", categoria: "Aves", regiao: "Minas Gerais",
    porcoes: 6, tempoPreparo: "1h",
    ingredientes: [
      { nome: "canjiquinha", medida: "1 xícara" },
      { nome: "frango em pedaços", medida: "500 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "linguiça calabresa", medida: "100 g" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Deixe a canjiquinha de molho em água por pelo menos 1 hora.",
      "Cozinhe o frango até ficar macio, desfie e reserve o caldo.",
      "Refogue a cebola, o alho e a linguiça fatiada.",
      "Junte a canjiquinha escorrida e o caldo do frango, cozinhando até a canjiquinha ficar macia, mexendo de vez em quando.",
      "Adicione o frango desfiado no final e ajuste o sal.",
    ],
  },
  {
    id: "r067", titulo: "Frango ensopado", categoria: "Aves",
    porcoes: 5, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "frango em pedaços", medida: "800 g" },
      { nome: "batata", medida: "3 unidades" },
      { nome: "cenoura", medida: "2 unidades" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "extrato de tomate", medida: "2 colheres de sopa" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o frango com sal e pimenta e doure no óleo.",
      "Refogue a cebola, o alho e o extrato de tomate.",
      "Cubra com água e cozinhe até o frango ficar macio.",
      "Junte a batata e a cenoura em pedaços e cozinhe até ficarem macias.",
    ],
  },
  {
    id: "r068", titulo: "Coxinha da asa frita", categoria: "Aves",
    porcoes: 5, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "coxinha da asa", medida: "1 kg" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "farinha de trigo", medida: "1 xícara" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere as coxinhas da asa com sal, pimenta, alho e limão e deixe marinando por 20 minutos.",
      "Passe levemente na farinha de trigo.",
      "Frite em óleo quente até ficarem douradas e crocantes por fora.",
    ],
  },
  {
    id: "r069", titulo: "Frango com molho de mostarda e mel", categoria: "Aves",
    porcoes: 4, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "peito de frango", medida: "4 unidades" },
      { nome: "mostarda", medida: "3 colheres de sopa" },
      { nome: "mel", medida: "2 colheres de sopa" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Misture a mostarda, o mel, o alho amassado, o azeite e o sal.",
      "Pincele o frango com o molho.",
      "Leve ao forno preaquecido ou grelhe até dourar e cozinhar por completo, pincelando o molho de vez em quando.",
    ],
  },
  {
    id: "r070", titulo: "Isca de peixe empanada", categoria: "Peixes e frutos do mar",
    porcoes: 4, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "filé de peixe em tiras", medida: "600 g" },
      { nome: "farinha de trigo", medida: "1 xícara" },
      { nome: "ovo", medida: "2 unidades" },
      { nome: "farinha de rosca", medida: "1 xícara" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o peixe com sal e limão.",
      "Passe as tiras na farinha de trigo, depois no ovo batido e por fim na farinha de rosca.",
      "Frite em óleo quente até dourar e escorra em papel toalha.",
    ],
  },
  {
    id: "r071", titulo: "Camarão no alho e óleo", categoria: "Peixes e frutos do mar",
    porcoes: 4, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "camarão limpo", medida: "500 g" },
      { nome: "alho", medida: "5 dentes" },
      { nome: "azeite", medida: "3 colheres de sopa" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "salsinha", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Tempere o camarão com sal e limão.",
      "Doure o alho fatiado no azeite, em fogo baixo.",
      "Junte o camarão e cozinhe rapidamente, em fogo alto, sem deixar ressecar.",
      "Finalize com salsinha picada e pimenta.",
    ],
  },
  {
    id: "r072", titulo: "Peixada", categoria: "Peixes e frutos do mar",
    porcoes: 5, tempoPreparo: "45 min",
    ingredientes: [
      { nome: "filé de peixe", medida: "600 g" },
      { nome: "batata", medida: "3 unidades" },
      { nome: "cenoura", medida: "2 unidades" },
      { nome: "tomate", medida: "2 unidades" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "coentro", medida: "1 colher de sopa" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Refogue a cebola, o alho e o tomate no azeite.",
      "Junte a batata e a cenoura em pedaços com água e cozinhe até quase ficarem macias.",
      "Adicione o peixe temperado com sal e cozinhe até ele ficar cozido.",
      "Finalize com coentro picado.",
    ],
  },
  {
    id: "r073", titulo: "Macarrão com atum", categoria: "Massas",
    porcoes: 5, tempoPreparo: "25 min",
    ingredientes: [
      { nome: "macarrão parafuso", medida: "500 g" },
      { nome: "atum em lata", medida: "2 latas" },
      { nome: "molho de tomate", medida: "300 ml" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o macarrão em água fervente com sal até ficar al dente.",
      "Refogue a cebola e o alho no azeite.",
      "Junte o atum escorrido e o molho de tomate e cozinhe por 10 minutos.",
      "Misture o molho ao macarrão escorrido e sirva.",
    ],
  },
  {
    id: "r074", titulo: "Capeletti ao molho branco", categoria: "Massas",
    porcoes: 5, tempoPreparo: "25 min",
    ingredientes: [
      { nome: "capeletti", medida: "500 g" },
      { nome: "manteiga", medida: "2 colheres de sopa" },
      { nome: "farinha de trigo", medida: "2 colheres de sopa" },
      { nome: "leite", medida: "2 xícaras" },
      { nome: "queijo parmesão ralado", medida: "50 g" },
      { nome: "noz-moscada", medida: "a gosto" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o capeletti em água fervente com sal, conforme o tempo indicado na embalagem.",
      "Derreta a manteiga, junte a farinha e mexa por um minuto.",
      "Adicione o leite aos poucos, mexendo sempre, até formar o molho branco.",
      "Tempere com noz-moscada, sal e o queijo parmesão, e misture ao capeletti escorrido.",
    ],
  },
  {
    id: "r075", titulo: "Fettuccine ao molho de tomate e manjericão", categoria: "Massas",
    porcoes: 5, tempoPreparo: "25 min",
    ingredientes: [
      { nome: "macarrão fettuccine", medida: "500 g" },
      { nome: "tomate", medida: "4 unidades" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "manjericão", medida: "1 colher de sopa" },
      { nome: "azeite", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe o fettuccine em água fervente com sal até ficar al dente.",
      "Doure o alho no azeite e junte o tomate picado, cozinhando até formar um molho.",
      "Tempere com sal e finalize com o manjericão fresco.",
      "Misture o molho à massa escorrida e sirva.",
    ],
  },
  {
    id: "r076", titulo: "Arroz de brócolis", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "25 min",
    ingredientes: [
      { nome: "arroz", medida: "2 xícaras" },
      { nome: "brócolis", medida: "1 xícara" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Refogue a cebola e o alho no óleo, junte o arroz e refogue por mais um minuto.",
      "Adicione água quente e sal e cozinhe até o arroz ficar quase pronto.",
      "Junte o brócolis picado e cozinhe até o arroz e o brócolis ficarem macios.",
    ],
  },
  {
    id: "r077", titulo: "Batata gratinada", categoria: "Acompanhamentos",
    porcoes: 5, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "batata", medida: "6 unidades" },
      { nome: "creme de leite", medida: "1 lata" },
      { nome: "queijo mussarela", medida: "150 g" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe as batatas fatiadas em rodelas até ficarem quase macias.",
      "Arrume em um refratário intercalando camadas de batata com o creme de leite temperado com alho e sal.",
      "Cubra com o queijo mussarela.",
      "Leve ao forno preaquecido até gratinar e dourar por cima.",
    ],
  },
  {
    id: "r078", titulo: "Salada verde simples", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "10 min",
    ingredientes: [
      { nome: "alface", medida: "1 unidade" },
      { nome: "tomate", medida: "2 unidades" },
      { nome: "pepino", medida: "1 unidade" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "limão", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Lave e corte a alface, o tomate e o pepino.",
      "Misture tudo em uma saladeira.",
      "Tempere com azeite, limão e sal na hora de servir.",
    ],
  },
  {
    id: "r079", titulo: "Abóbora refogada", categoria: "Acompanhamentos",
    porcoes: 4, tempoPreparo: "25 min",
    ingredientes: [
      { nome: "abóbora", medida: "600 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Corte a abóbora em cubos.",
      "Refogue a cebola e o alho no azeite.",
      "Junte a abóbora e um pouco de água, cozinhando até ela ficar macia.",
    ],
  },
  {
    id: "r080", titulo: "Lentilha guisada", categoria: "Vegetariano",
    porcoes: 5, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "lentilha", medida: "2 xícaras" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "3 dentes" },
      { nome: "tomate", medida: "1 unidade" },
      { nome: "cenoura", medida: "1 unidade" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "folha de louro", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe a lentilha com a folha de louro até ficar macia.",
      "Refogue a cebola, o alho, o tomate e a cenoura no azeite.",
      "Junte o refogado à lentilha cozida e cozinhe por mais 10 minutos.",
      "Ajuste o sal e sirva.",
    ],
  },
  {
    id: "r081", titulo: "Risoto de legumes", categoria: "Vegetariano",
    porcoes: 5, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "arroz arbóreo", medida: "2 xícaras" },
      { nome: "cenoura", medida: "1 unidade" },
      { nome: "abobrinha", medida: "1 unidade" },
      { nome: "ervilha", medida: "1/2 xícara" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "queijo parmesão ralado", medida: "50 g" },
      { nome: "manteiga", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Refogue a cebola e o alho na manteiga, junte o arroz e refogue por mais um minuto.",
      "Adicione água quente aos poucos, mexendo sempre, até o arroz quase cozinhar.",
      "Junte a cenoura, a abobrinha e a ervilha picadas no meio do cozimento.",
      "Finalize com o queijo parmesão e ajuste o sal.",
    ],
  },
  {
    id: "r082", titulo: "Quibe de abóbora", categoria: "Vegetariano",
    porcoes: 6, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "trigo para quibe", medida: "1 xícara" },
      { nome: "abóbora cozida e amassada", medida: "2 xícaras" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "hortelã", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "óleo", medida: "3 colheres de sopa" },
    ],
    modoPreparo: [
      "Hidrate o trigo para quibe em água morna por 15 minutos e escorra bem.",
      "Misture o trigo com a abóbora amassada, a cebola ralada, a hortelã e o sal.",
      "Molde os quibes.",
      "Frite em óleo quente até dourarem, ou asse em forno preaquecido.",
    ],
  },
  {
    id: "r083", titulo: "Vitamina de banana", categoria: "Café da manhã",
    porcoes: 2, tempoPreparo: "5 min",
    ingredientes: [
      { nome: "banana", medida: "2 unidades" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "açúcar", medida: "1 colher de sopa" },
      { nome: "aveia", medida: "2 colheres de sopa" },
    ],
    modoPreparo: [
      "Bata todos os ingredientes no liquidificador até ficar homogêneo.",
      "Sirva gelado.",
    ],
  },
  {
    id: "r084", titulo: "Bolo de milho", categoria: "Café da manhã",
    porcoes: 10, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "milho", medida: "2 xícaras" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "ovo", medida: "3 unidades" },
      { nome: "açúcar", medida: "1 xícara" },
      { nome: "farinha de trigo", medida: "1 xícara" },
      { nome: "fermento em pó", medida: "1 colher de sopa" },
      { nome: "óleo", medida: "1/2 xícara" },
    ],
    modoPreparo: [
      "Bata no liquidificador o milho, o leite, os ovos, o açúcar e o óleo.",
      "Misture com a farinha de trigo até ficar homogêneo.",
      "Adicione o fermento delicadamente por último.",
      "Despeje em uma forma untada e asse em forno preaquecido até dourar.",
    ],
  },
  {
    id: "r085", titulo: "Panqueca americana", categoria: "Café da manhã",
    porcoes: 3, tempoPreparo: "20 min",
    ingredientes: [
      { nome: "farinha de trigo", medida: "1 xícara" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "açúcar", medida: "1 colher de sopa" },
      { nome: "fermento em pó", medida: "1 colher de chá" },
      { nome: "manteiga", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Misture todos os ingredientes até formar uma massa lisa, sem grumos.",
      "Frite pequenas porções da massa em frigideira untada, em fogo baixo.",
      "Vire quando surgirem bolhas na superfície e doure o outro lado.",
    ],
  },
  {
    id: "r086", titulo: "Mingau de aveia", categoria: "Café da manhã",
    porcoes: 2, tempoPreparo: "10 min",
    ingredientes: [
      { nome: "aveia", medida: "1 xícara" },
      { nome: "leite", medida: "2 xícaras" },
      { nome: "açúcar", medida: "2 colheres de sopa" },
      { nome: "canela", medida: "a gosto" },
    ],
    modoPreparo: [
      "Misture a aveia com o leite em uma panela.",
      "Cozinhe em fogo baixo, mexendo sempre, até engrossar.",
      "Adoce e finalize com canela.",
    ],
  },
  {
    id: "r087", titulo: "Risole de frango", categoria: "Salgados",
    porcoes: 15, tempoPreparo: "1h",
    ingredientes: [
      { nome: "peito de frango cozido e desfiado", medida: "300 g" },
      { nome: "farinha de trigo", medida: "2 xícaras" },
      { nome: "leite", medida: "2 xícaras" },
      { nome: "manteiga", medida: "2 colheres de sopa" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "farinha de rosca", medida: "1 xícara" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Leve o leite e a manteiga ao fogo e, quando ferver, junte a farinha de trigo de uma vez, mexendo até desgrudar da panela, formando a massa.",
      "Refogue a cebola com o frango desfiado e tempere, formando o recheio.",
      "Abra porções da massa já fria, recheie e feche em formato de meia-lua.",
      "Passe no ovo batido e na farinha de rosca.",
      "Frite em óleo quente até dourar.",
    ],
  },
  {
    id: "r088", titulo: "Enroladinho de salsicha", categoria: "Salgados",
    porcoes: 10, tempoPreparo: "1h",
    ingredientes: [
      { nome: "salsicha", medida: "10 unidades" },
      { nome: "farinha de trigo", medida: "2 xícaras" },
      { nome: "fermento biológico", medida: "1 colher de sopa" },
      { nome: "leite", medida: "1 xícara" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "gergelim", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Misture a farinha, o fermento, o leite, o óleo e o sal, sovando até formar uma massa lisa.",
      "Deixe a massa descansar até crescer.",
      "Abra porções da massa e enrole em volta de cada salsicha.",
      "Deixe crescer por mais 15 minutos, pincele com leite e polvilhe gergelim.",
      "Asse em forno preaquecido até dourar.",
    ],
  },
  {
    id: "r089", titulo: "Empada de palmito", categoria: "Salgados",
    porcoes: 12, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "farinha de trigo", medida: "3 xícaras" },
      { nome: "manteiga", medida: "200 g" },
      { nome: "ovo", medida: "1 unidade" },
      { nome: "palmito", medida: "300 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "molho de tomate", medida: "100 ml" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Misture a farinha, a manteiga gelada e o sal até formar uma farofa, e junte água aos poucos até dar liga.",
      "Refogue a cebola e o palmito picado com o molho de tomate, formando o recheio.",
      "Forre forminhas com a massa, recheie e cubra com mais massa.",
      "Pincele com ovo batido e asse em forno preaquecido até dourar.",
    ],
  },
  {
    id: "r090", titulo: "Bolinho de bacalhau", categoria: "Salgados",
    porcoes: 8, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "bacalhau dessalgado e desfiado", medida: "400 g" },
      { nome: "batata", medida: "4 unidades" },
      { nome: "ovo", medida: "2 unidades" },
      { nome: "salsinha", medida: "1 colher de sopa" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "óleo", medida: "3 colheres de sopa" },
      { nome: "pimenta", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe a batata e amasse ainda quente.",
      "Misture com o bacalhau desfiado, os ovos, o alho e a salsinha, temperando com pimenta.",
      "Molde pequenas bolinhas.",
      "Frite em óleo quente até dourarem por completo.",
    ],
  },
  {
    id: "r091", titulo: "Kibe frito", categoria: "Salgados",
    porcoes: 8, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "trigo para quibe", medida: "1 xícara" },
      { nome: "carne moída", medida: "400 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "hortelã", medida: "1 colher de sopa" },
      { nome: "sal", medida: "a gosto" },
      { nome: "pimenta", medida: "a gosto" },
      { nome: "óleo", medida: "3 colheres de sopa" },
    ],
    modoPreparo: [
      "Hidrate o trigo para quibe em água morna e escorra bem, apertando para tirar o excesso de água.",
      "Misture com a carne moída, a cebola ralada, a hortelã, o sal e a pimenta até formar uma massa homogênea.",
      "Molde os quibes no formato tradicional.",
      "Frite em óleo quente até dourarem bem por fora.",
    ],
  },
  {
    id: "r092", titulo: "Torta de limão", categoria: "Sobremesas",
    porcoes: 8, tempoPreparo: "20 min (+ geladeira)",
    ingredientes: [
      { nome: "biscoito maisena", medida: "200 g" },
      { nome: "manteiga", medida: "100 g" },
      { nome: "leite condensado", medida: "1 lata" },
      { nome: "creme de leite", medida: "1 lata" },
      { nome: "suco de limão", medida: "1/2 xícara" },
      { nome: "raspas de limão", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Triture o biscoito e misture com a manteiga derretida, forrando o fundo de uma forma.",
      "Bata o leite condensado com o suco de limão e o creme de leite até engrossar.",
      "Despeje sobre a base de biscoito.",
      "Finalize com as raspas de limão e leve à geladeira por pelo menos 2 horas antes de servir.",
    ],
  },
  {
    id: "r093", titulo: "Cocada", categoria: "Sobremesas",
    porcoes: 15, tempoPreparo: "30 min",
    ingredientes: [
      { nome: "coco ralado", medida: "2 xícaras" },
      { nome: "açúcar", medida: "2 xícaras" },
      { nome: "água", medida: "1/2 xícara" },
    ],
    modoPreparo: [
      "Misture o coco ralado, o açúcar e a água em uma panela.",
      "Cozinhe em fogo médio, mexendo sempre, até engrossar e soltar do fundo da panela.",
      "Despeje colheradas sobre uma superfície untada e deixe esfriar antes de servir.",
    ],
  },
  {
    id: "r094", titulo: "Paçoca", categoria: "Sobremesas",
    porcoes: 12, tempoPreparo: "15 min",
    ingredientes: [
      { nome: "amendoim torrado e moído", medida: "2 xícaras" },
      { nome: "açúcar", medida: "1 xícara" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Misture o amendoim moído com o açúcar e uma pitada de sal.",
      "Aperte bem a mistura dentro de forminhas até compactar.",
      "Desenforme com cuidado, pois a paçoca é bem quebradiça.",
    ],
  },
  {
    id: "r095", titulo: "Romeu e Julieta", categoria: "Sobremesas",
    porcoes: 6, tempoPreparo: "5 min",
    ingredientes: [
      { nome: "queijo minas", medida: "300 g" },
      { nome: "goiabada", medida: "300 g" },
    ],
    modoPreparo: [
      "Corte o queijo e a goiabada em fatias.",
      "Sirva juntos, um ao lado do outro ou intercalados.",
    ],
  },
  {
    id: "r096", titulo: "Canjica", categoria: "Sobremesas",
    porcoes: 8, tempoPreparo: "1h (+ tempo de molho)",
    ingredientes: [
      { nome: "canjica de milho branco", medida: "2 xícaras" },
      { nome: "leite", medida: "1 litro" },
      { nome: "leite de coco", medida: "200 ml" },
      { nome: "açúcar", medida: "1 xícara" },
      { nome: "canela", medida: "1 colher de chá" },
      { nome: "cravo", medida: "2 unidades" },
    ],
    modoPreparo: [
      "Deixe a canjica de molho em água de um dia para o outro.",
      "Cozinhe a canjica até ficar bem macia.",
      "Junte o leite, o leite de coco, o açúcar e o cravo, e cozinhe em fogo baixo até engrossar.",
      "Finalize com canela e sirva morna ou gelada.",
    ],
  },
  {
    id: "r097", titulo: "Quindim", categoria: "Sobremesas",
    porcoes: 10, tempoPreparo: "50 min",
    ingredientes: [
      { nome: "gema de ovo", medida: "6 unidades" },
      { nome: "açúcar", medida: "1 xícara" },
      { nome: "coco ralado", medida: "1 xícara" },
      { nome: "manteiga", medida: "1 colher de sopa" },
    ],
    modoPreparo: [
      "Misture as gemas, o açúcar, o coco ralado e a manteiga derretida.",
      "Despeje em forminhas untadas e levemente açucaradas.",
      "Asse em banho-maria, em forno preaquecido, até firmar e dourar por cima.",
      "Deixe esfriar antes de desenformar.",
    ],
  },
  {
    id: "r098", titulo: "Caldo verde", categoria: "Sopas e caldos",
    porcoes: 6, tempoPreparo: "40 min",
    ingredientes: [
      { nome: "batata", medida: "4 unidades" },
      { nome: "couve", medida: "1 maço" },
      { nome: "linguiça calabresa", medida: "150 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "azeite", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Cozinhe a batata com a cebola e o alho até ficarem bem macias.",
      "Bata no liquidificador com um pouco da água do cozimento até formar um creme liso.",
      "Volte ao fogo, junte a couve cortada bem fina e a linguiça fatiada e já frita.",
      "Cozinhe por mais alguns minutos e finalize com um fio de azeite.",
    ],
  },
  {
    id: "r099", titulo: "Sopa de legumes", categoria: "Sopas e caldos",
    porcoes: 5, tempoPreparo: "35 min",
    ingredientes: [
      { nome: "batata", medida: "2 unidades" },
      { nome: "cenoura", medida: "2 unidades" },
      { nome: "chuchu", medida: "1 unidade" },
      { nome: "abobrinha", medida: "1 unidade" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "óleo", medida: "2 colheres de sopa" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Refogue a cebola e o alho no óleo.",
      "Junte os demais legumes picados e água o suficiente para cobrir.",
      "Cozinhe até os legumes ficarem macios.",
      "Ajuste o sal e sirva quente.",
    ],
  },
  {
    id: "r100", titulo: "Caldinho de feijão", categoria: "Sopas e caldos",
    porcoes: 6, tempoPreparo: "25 min",
    ingredientes: [
      { nome: "feijão cozido", medida: "3 xícaras" },
      { nome: "bacon", medida: "100 g" },
      { nome: "cebola", medida: "1 unidade" },
      { nome: "alho", medida: "2 dentes" },
      { nome: "folha de louro", medida: "1 unidade" },
      { nome: "sal", medida: "a gosto" },
    ],
    modoPreparo: [
      "Frite o bacon em cubos até dourar.",
      "Junte a cebola e o alho e refogue.",
      "Adicione o feijão cozido com um pouco do caldo e a folha de louro.",
      "Bata no liquidificador até ficar cremoso, volte ao fogo para aquecer e ajuste o sal.",
    ],
  },
];


// ================= NUTRIÇÃO (BASE LOCAL) =================
// Estimativa de valores nutricionais sem depender de nenhuma API externa.
// Guarda valores médios por 100g dos ingredientes mais comuns em receitas
// (fonte: valores de referência nutricional públicos, tipo USDA). É uma
// estimativa aproximada — não considera marca, preparo ou densidade exata.

const NOMES_NUTRIENTES = {
  calories: "Calorias",
  protein_g: "Proteínas",
  fat_total_g: "Gorduras",
  carbohydrates_total_g: "Carboidratos",
  sugar_g: "Açúcares",
  fiber_g: "Fibras",
  sodium_mg: "Sódio",
};

const UNIDADES_NUTRIENTES = {
  calories: " kcal",
  protein_g: "g",
  fat_total_g: "g",
  carbohydrates_total_g: "g",
  sugar_g: "g",
  fiber_g: "g",
  sodium_mg: "mg",
};

const ORDEM_NUTRIENTES = [
  "calories", "protein_g", "fat_total_g",
  "carbohydrates_total_g", "fiber_g", "sugar_g", "sodium_mg"
];

// Valores aproximados por 100g: { calories, protein_g, fat_total_g, carbohydrates_total_g, fiber_g, sugar_g, sodium_mg }
const BASE_NUTRICIONAL = {
  "chicken breast": { calories:165, protein_g:31, fat_total_g:3.6, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:74 },
  "chicken thigh": { calories:209, protein_g:26, fat_total_g:10.9, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:84 },
  "chicken": { calories:215, protein_g:18, fat_total_g:15, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:82 },
  "turkey": { calories:135, protein_g:30, fat_total_g:1, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:60 },
  "ground beef": { calories:250, protein_g:26, fat_total_g:17, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:66 },
  "beef steak": { calories:271, protein_g:25, fat_total_g:19, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:58 },
  "beef": { calories:250, protein_g:26, fat_total_g:15, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:66 },
  "pork": { calories:242, protein_g:27, fat_total_g:14, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:62 },
  "bacon": { calories:541, protein_g:37, fat_total_g:42, carbohydrates_total_g:1.4, fiber_g:0, sugar_g:0, sodium_mg:1717 },
  "sausage": { calories:301, protein_g:12, fat_total_g:27, carbohydrates_total_g:1, fiber_g:0, sugar_g:0, sodium_mg:850 },
  "ham": { calories:145, protein_g:21, fat_total_g:5.5, carbohydrates_total_g:1.5, fiber_g:0, sugar_g:1, sodium_mg:1203 },
  "lamb": { calories:294, protein_g:25, fat_total_g:21, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:72 },
  "duck": { calories:337, protein_g:19, fat_total_g:28, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:63 },
  "salmon": { calories:208, protein_g:20, fat_total_g:13, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:59 },
  "tuna": { calories:132, protein_g:28, fat_total_g:1, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:39 },
  "shrimp": { calories:99, protein_g:24, fat_total_g:0.3, carbohydrates_total_g:0.2, fiber_g:0, sugar_g:0, sodium_mg:111 },
  "crab": { calories:97, protein_g:19, fat_total_g:1.5, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:293 },
  "fish": { calories:105, protein_g:22, fat_total_g:2, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:70 },
  "egg white": { calories:52, protein_g:11, fat_total_g:0.2, carbohydrates_total_g:0.7, fiber_g:0, sugar_g:0.7, sodium_mg:166 },
  "egg": { calories:155, protein_g:13, fat_total_g:11, carbohydrates_total_g:1.1, fiber_g:0, sugar_g:1.1, sodium_mg:124 },

  "milk": { calories:42, protein_g:3.4, fat_total_g:1, carbohydrates_total_g:5, fiber_g:0, sugar_g:5, sodium_mg:44 },
  "coconut milk": { calories:230, protein_g:2.3, fat_total_g:24, carbohydrates_total_g:6, fiber_g:2.2, sugar_g:3.3, sodium_mg:15 },
  "cream cheese": { calories:342, protein_g:6, fat_total_g:34, carbohydrates_total_g:4, fiber_g:0, sugar_g:3.2, sodium_mg:321 },
  "sour cream": { calories:198, protein_g:2.4, fat_total_g:19, carbohydrates_total_g:4.6, fiber_g:0, sugar_g:3.4, sodium_mg:32 },
  "cream": { calories:340, protein_g:2.1, fat_total_g:36, carbohydrates_total_g:3, fiber_g:0, sugar_g:3, sodium_mg:38 },
  "butter": { calories:717, protein_g:0.9, fat_total_g:81, carbohydrates_total_g:0.1, fiber_g:0, sugar_g:0.1, sodium_mg:11 },
  "parmesan": { calories:431, protein_g:38, fat_total_g:29, carbohydrates_total_g:4.1, fiber_g:0, sugar_g:0.9, sodium_mg:1529 },
  "mozzarella": { calories:280, protein_g:28, fat_total_g:17, carbohydrates_total_g:3.1, fiber_g:0, sugar_g:1.2, sodium_mg:627 },
  "cheddar": { calories:403, protein_g:25, fat_total_g:33, carbohydrates_total_g:1.3, fiber_g:0, sugar_g:0.5, sodium_mg:621 },
  "cheese": { calories:350, protein_g:23, fat_total_g:28, carbohydrates_total_g:2.5, fiber_g:0, sugar_g:0.5, sodium_mg:600 },
  "yogurt": { calories:61, protein_g:3.5, fat_total_g:3.3, carbohydrates_total_g:4.7, fiber_g:0, sugar_g:4.7, sodium_mg:36 },

  "white rice": { calories:130, protein_g:2.7, fat_total_g:0.3, carbohydrates_total_g:28, fiber_g:0.4, sugar_g:0.1, sodium_mg:1 },
  "brown rice": { calories:123, protein_g:2.7, fat_total_g:1, carbohydrates_total_g:26, fiber_g:1.6, sugar_g:0.2, sodium_mg:4 },
  "rice": { calories:130, protein_g:2.7, fat_total_g:0.3, carbohydrates_total_g:28, fiber_g:0.4, sugar_g:0.1, sodium_mg:1 },
  "pasta": { calories:131, protein_g:5, fat_total_g:1.1, carbohydrates_total_g:25, fiber_g:1.8, sugar_g:0.6, sodium_mg:1 },
  "spaghetti": { calories:131, protein_g:5, fat_total_g:1.1, carbohydrates_total_g:25, fiber_g:1.8, sugar_g:0.6, sodium_mg:1 },
  "bread": { calories:265, protein_g:9, fat_total_g:3.2, carbohydrates_total_g:49, fiber_g:2.7, sugar_g:5, sodium_mg:491 },
  "flour": { calories:364, protein_g:10, fat_total_g:1, carbohydrates_total_g:76, fiber_g:2.7, sugar_g:0.3, sodium_mg:2 },
  "sweet potato": { calories:86, protein_g:1.6, fat_total_g:0.1, carbohydrates_total_g:20, fiber_g:3, sugar_g:4.2, sodium_mg:55 },
  "potato": { calories:77, protein_g:2, fat_total_g:0.1, carbohydrates_total_g:17, fiber_g:2.2, sugar_g:0.8, sodium_mg:6 },
  "corn": { calories:86, protein_g:3.2, fat_total_g:1.2, carbohydrates_total_g:19, fiber_g:2.7, sugar_g:6.3, sodium_mg:15 },
  "cassava": { calories:160, protein_g:1.4, fat_total_g:0.3, carbohydrates_total_g:38, fiber_g:1.8, sugar_g:1.7, sodium_mg:14 },

  "black bean": { calories:132, protein_g:8.9, fat_total_g:0.5, carbohydrates_total_g:24, fiber_g:8.7, sugar_g:0.3, sodium_mg:1 },
  "bean": { calories:130, protein_g:8.5, fat_total_g:0.5, carbohydrates_total_g:23, fiber_g:7, sugar_g:0.3, sodium_mg:2 },
  "chickpea": { calories:164, protein_g:8.9, fat_total_g:2.6, carbohydrates_total_g:27, fiber_g:7.6, sugar_g:4.8, sodium_mg:7 },

  "onion": { calories:40, protein_g:1.1, fat_total_g:0.1, carbohydrates_total_g:9.3, fiber_g:1.7, sugar_g:4.2, sodium_mg:4 },
  "garlic": { calories:149, protein_g:6.4, fat_total_g:0.5, carbohydrates_total_g:33, fiber_g:2.1, sugar_g:1, sodium_mg:17 },
  "tomato": { calories:18, protein_g:0.9, fat_total_g:0.2, carbohydrates_total_g:3.9, fiber_g:1.2, sugar_g:2.6, sodium_mg:5 },
  "carrot": { calories:41, protein_g:0.9, fat_total_g:0.2, carbohydrates_total_g:10, fiber_g:2.8, sugar_g:4.7, sodium_mg:69 },
  "bell pepper": { calories:31, protein_g:1, fat_total_g:0.3, carbohydrates_total_g:6, fiber_g:2.1, sugar_g:4.2, sodium_mg:4 },
  "okra": { calories:33, protein_g:1.9, fat_total_g:0.2, carbohydrates_total_g:7.5, fiber_g:3.2, sugar_g:1.5, sodium_mg:7 },
  "spinach": { calories:23, protein_g:2.9, fat_total_g:0.4, carbohydrates_total_g:3.6, fiber_g:2.2, sugar_g:0.4, sodium_mg:79 },
  "broccoli": { calories:34, protein_g:2.8, fat_total_g:0.4, carbohydrates_total_g:7, fiber_g:2.6, sugar_g:1.7, sodium_mg:33 },
  "mushroom": { calories:22, protein_g:3.1, fat_total_g:0.3, carbohydrates_total_g:3.3, fiber_g:1, sugar_g:2, sodium_mg:5 },
  "zucchini": { calories:17, protein_g:1.2, fat_total_g:0.3, carbohydrates_total_g:3.1, fiber_g:1, sugar_g:2.5, sodium_mg:8 },
  "pea": { calories:81, protein_g:5.4, fat_total_g:0.4, carbohydrates_total_g:14, fiber_g:5.7, sugar_g:5.7, sodium_mg:5 },
  "collard greens": { calories:32, protein_g:3, fat_total_g:0.6, carbohydrates_total_g:5.4, fiber_g:4, sugar_g:0.5, sodium_mg:20 },

  "lime": { calories:30, protein_g:0.7, fat_total_g:0.2, carbohydrates_total_g:11, fiber_g:2.8, sugar_g:1.7, sodium_mg:2 },
  "lemon": { calories:29, protein_g:1.1, fat_total_g:0.3, carbohydrates_total_g:9.3, fiber_g:2.8, sugar_g:2.5, sodium_mg:2 },
  "coconut": { calories:354, protein_g:3.3, fat_total_g:33, carbohydrates_total_g:15, fiber_g:9, sugar_g:6.2, sodium_mg:20 },

  "olive oil": { calories:884, protein_g:0, fat_total_g:100, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:2 },
  "palm oil": { calories:884, protein_g:0, fat_total_g:100, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:0 },
  "oil": { calories:884, protein_g:0, fat_total_g:100, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:0 },

  "sugar": { calories:387, protein_g:0, fat_total_g:0, carbohydrates_total_g:100, fiber_g:0, sugar_g:100, sodium_mg:1 },
  "condensed milk": { calories:321, protein_g:7.9, fat_total_g:8.7, carbohydrates_total_g:54.4, fiber_g:0, sugar_g:54, sodium_mg:127 },
  "chocolate": { calories:546, protein_g:4.9, fat_total_g:31, carbohydrates_total_g:61, fiber_g:7, sugar_g:48, sodium_mg:24 },
  "cocoa": { calories:228, protein_g:19.6, fat_total_g:13.7, carbohydrates_total_g:57.9, fiber_g:37, sugar_g:1.8, sodium_mg:21 },

  "mayonnaise": { calories:680, protein_g:1, fat_total_g:75, carbohydrates_total_g:0.6, fiber_g:0, sugar_g:0.6, sodium_mg:635 },
  "ketchup": { calories:101, protein_g:1.3, fat_total_g:0.1, carbohydrates_total_g:26, fiber_g:0.3, sugar_g:22, sodium_mg:1110 },
  "mustard": { calories:66, protein_g:4.4, fat_total_g:3.3, carbohydrates_total_g:5.8, fiber_g:3.3, sugar_g:2.9, sodium_mg:1135 },
  "tomato sauce": { calories:29, protein_g:1.4, fat_total_g:0.3, carbohydrates_total_g:6.6, fiber_g:1.5, sugar_g:4, sodium_mg:340 },
  "chicken stock": { calories:5, protein_g:0.8, fat_total_g:0.2, carbohydrates_total_g:0.5, fiber_g:0, sugar_g:0.1, sodium_mg:380 },

  "salt": { calories:0, protein_g:0, fat_total_g:0, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:38758 },
  "black pepper": { calories:251, protein_g:10.4, fat_total_g:3.3, carbohydrates_total_g:64, fiber_g:25, sugar_g:0.6, sodium_mg:20 },
  "paprika": { calories:282, protein_g:14.1, fat_total_g:13, carbohydrates_total_g:54, fiber_g:35, sugar_g:10, sodium_mg:68 },
  "oregano": { calories:265, protein_g:9, fat_total_g:4.3, carbohydrates_total_g:69, fiber_g:43, sugar_g:4.1, sodium_mg:25 },
  "parsley": { calories:36, protein_g:3, fat_total_g:0.8, carbohydrates_total_g:6.3, fiber_g:3.3, sugar_g:0.9, sodium_mg:56 },
  "cilantro": { calories:23, protein_g:2.1, fat_total_g:0.5, carbohydrates_total_g:3.7, fiber_g:2.8, sugar_g:0.9, sodium_mg:46 },
  "turmeric": { calories:312, protein_g:9.7, fat_total_g:3.3, carbohydrates_total_g:67, fiber_g:23, sugar_g:3.2, sodium_mg:38 },
  "baking powder": { calories:53, protein_g:0, fat_total_g:0, carbohydrates_total_g:28, fiber_g:0.2, sugar_g:0, sodium_mg:10600 },
  "bay leaf": { calories:313, protein_g:7.6, fat_total_g:8.4, carbohydrates_total_g:75, fiber_g:26, sugar_g:0, sodium_mg:23 },
  "water": { calories:0, protein_g:0, fat_total_g:0, carbohydrates_total_g:0, fiber_g:0, sugar_g:0, sodium_mg:0 },
  "cucumber": { calories:16, protein_g:0.7, fat_total_g:0.1, carbohydrates_total_g:3.6, fiber_g:0.5, sugar_g:1.7, sodium_mg:2 },
  "peanut": { calories:567, protein_g:25.8, fat_total_g:49.2, carbohydrates_total_g:16.1, fiber_g:8.5, sugar_g:4.7, sodium_mg:18 },
  "honey": { calories:304, protein_g:0.3, fat_total_g:0, carbohydrates_total_g:82.4, fiber_g:0.2, sugar_g:82.1, sodium_mg:4 },
  "guava paste": { calories:280, protein_g:0.4, fat_total_g:0.1, carbohydrates_total_g:70, fiber_g:3, sugar_g:65, sodium_mg:10 },
  "heart of palm": { calories:28, protein_g:2.5, fat_total_g:0.5, carbohydrates_total_g:4.3, fiber_g:2.4, sugar_g:1, sodium_mg:622 },
  "basil": { calories:23, protein_g:3.2, fat_total_g:0.6, carbohydrates_total_g:2.7, fiber_g:1.6, sugar_g:0.3, sodium_mg:4 },
  "bulgur": { calories:83, protein_g:3.1, fat_total_g:0.2, carbohydrates_total_g:18.6, fiber_g:4.5, sugar_g:0.1, sodium_mg:5 },
  "egg yolk": { calories:322, protein_g:15.9, fat_total_g:26.5, carbohydrates_total_g:3.6, fiber_g:0, sugar_g:0.6, sodium_mg:48 },
  "cookie": { calories:443, protein_g:5.8, fat_total_g:16, carbohydrates_total_g:68, fiber_g:2, sugar_g:30, sodium_mg:300 },
};

// ---- Tabela pt -> en só pra achar a receita na base nutricional acima
// (a base em si é internacional; aqui só convertemos o nome pra achar o
// valor certo, não é usada pra mostrar nada na tela). ----
const NOMES_NUTRICAO_PT_EN = [
  ["carne seca","beef"], ["carne bovina","beef"], ["carne moída","ground beef"], ["carne","beef"],
  ["bacalhau","fish"], ["siri","crab"], ["pepino","cucumber"], ["amendoim","peanut"],
  ["mel","honey"], ["goiabada","guava paste"], ["palmito","heart of palm"], ["salsicha","sausage"],
  ["trigo para quibe","bulgur"], ["chuchu","zucchini"], ["canjiquinha","corn"], ["canjica","corn"],
  ["biscoito maisena","cookie"], ["manjericão","basil"], ["gema de ovo","egg yolk"],
  ["costelinha de porco","pork"], ["bacon","bacon"], ["linguiça","sausage"], ["presunto","ham"],
  ["peito de frango","chicken breast"], ["coxa de frango","chicken thigh"], ["frango","chicken"],
  ["peru","turkey"], ["filé de peixe","fish"], ["peixe","fish"], ["camarão","shrimp"],
  ["ovo","egg"], ["queijo coalho","cheese"], ["queijo minas","cheese"], ["queijo mussarela","mozzarella"],
  ["queijo parmesão","parmesan"], ["queijo ralado","cheese"], ["queijo","cheese"],
  ["leite condensado","condensed milk"], ["leite de coco","coconut milk"], ["leite","milk"],
  ["manteiga","butter"], ["creme de leite","cream"], ["maionese","mayonnaise"],
  ["arroz","rice"], ["feijão de corda","bean"], ["feijão preto","black bean"], ["feijão","bean"],
  ["grão de bico","chickpea"], ["macarrão","pasta"], ["massa de lasanha","pasta"], ["massa de pastel","flour"],
  ["farinha de mandioca","cassava"], ["farinha de rosca","bread"], ["farinha de trigo","flour"], ["farinha","flour"],
  ["fubá","corn"], ["polvilho azedo","cassava"], ["mandioca","cassava"],
  ["batata doce","sweet potato"], ["batata","potato"], ["milho","corn"], ["ervilha","pea"],
  ["cebola","onion"], ["alho","garlic"], ["tomate","tomato"], ["cenoura","carrot"],
  ["pimentão","bell pepper"], ["quiabo","okra"], ["couve","collard greens"], ["brócolis","broccoli"],
  ["abobrinha","zucchini"], ["champignon","mushroom"], ["coentro","cilantro"], ["cebolinha","onion"],
  ["salsinha","parsley"], ["orégano","oregano"], ["açafrão","turmeric"], ["colorau","paprika"],
  ["cravo","black pepper"], ["folha de louro","bay leaf"], ["limão","lime"],
  ["coco ralado","coconut"], ["azeite de dendê","palm oil"], ["azeite","olive oil"], ["óleo","oil"],
  ["açúcar","sugar"], ["chocolate em pó","cocoa"], ["chocolate granulado","chocolate"],
  ["extrato de tomate","tomato sauce"], ["molho de tomate","tomato sauce"], ["ketchup","ketchup"],
  ["mostarda","mustard"], ["caldo de galinha","chicken stock"], ["fermento em pó","baking powder"],
  ["sal","salt"], ["pimenta","black pepper"], ["água","water"],
];

// Remove acentos, deixa em minúsculo e tira caracteres não alfabéticos,
// pra comparar nomes de ingredientes de forma mais tolerante.
function normalizarNomeIngrediente(nome) {
  return (nome || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Acha, na tabela pt->en, a chave em português mais específica (mais
// longa) contida no nome do ingrediente, e devolve o termo em inglês
// correspondente na base nutricional.
const CHAVES_NUTRICAO_PT_ORDENADAS = NOMES_NUTRICAO_PT_EN
  .map(([pt, en]) => [normalizarNomeIngrediente(pt), en])
  .sort((a, b) => b[0].length - a[0].length);

function traduzirNomeParaBaseNutricional(nomePt) {
  const normalizado = normalizarNomeIngrediente(nomePt);
  const encontrado = CHAVES_NUTRICAO_PT_ORDENADAS.find(([pt]) => normalizado.includes(pt));
  return encontrado ? encontrado[1] : normalizado;
}

// Acha o item da base local que melhor combina com o nome do ingrediente.
// Prioriza as chaves mais específicas (mais longas) pra evitar confundir,
// por exemplo, "coconut milk" com "milk".
const CHAVES_BASE_ORDENADAS = Object.keys(BASE_NUTRICIONAL).sort((a, b) => b.length - a.length);

function buscarBaseIngrediente(nomeIngredienteEn) {
  const normalizado = normalizarNomeIngrediente(nomeIngredienteEn);
  for (const chave of CHAVES_BASE_ORDENADAS) {
    if (normalizado.includes(chave)) {
      return BASE_NUTRICIONAL[chave];
    }
  }
  return null;
}

// Estima o peso em gramas de uma medida em texto livre em português
// (ex: "2 xícaras", "1 colher de sopa", "500 g", "3 unidades"). Quando não
// há unidade de peso reconhecida, assume um peso médio por unidade.
function estimarGramas(medida) {

  const texto = (medida || "").toLowerCase().trim();

  const matchNumero = texto.match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+(\.\d+)?)/);
  let quantidade = 1;

  if (matchNumero) {
    const numStr = matchNumero[1];
    if (numStr.includes(" ")) {
      const [inteiro, fracao] = numStr.split(" ");
      const [num, den] = fracao.split("/").map(Number);
      quantidade = parseFloat(inteiro) + (num / den);
    } else if (numStr.includes("/")) {
      const [num, den] = numStr.split("/").map(Number);
      quantidade = num / den;
    } else {
      quantidade = parseFloat(numStr);
    }
  }

  if (!quantidade || isNaN(quantidade)) quantidade = 1;

  const unidadesPeso = [
    { regex: /a gosto|opcional/, gramas: 1.5 },
    { regex: /mililitro|\bml\b/, gramas: 1 },
    { regex: /quilo|\bkg\b/, gramas: 1000 },
    { regex: /litro|\bl\b/, gramas: 1000 },
    { regex: /grama|\bg\b/, gramas: 1 },
    { regex: /xícara/, gramas: 240 },
    { regex: /colher(es)? de sopa/, gramas: 15 },
    { regex: /colher(es)? de ch[aá]/, gramas: 5 },
    { regex: /dente/, gramas: 5 },
    { regex: /fatia/, gramas: 25 },
    { regex: /\blata\b/, gramas: 400 },
    { regex: /pitada/, gramas: 0.5 },
    { regex: /punhado/, gramas: 30 },
  ];

  for (const u of unidadesPeso) {
    if (u.regex.test(texto)) {
      return quantidade * u.gramas;
    }
  }

  // Sem unidade de peso reconhecida: assume um peso médio por unidade
  // (ex: "3 ovos", "1 cebola" etc.)
  return quantidade * 50;

}

// Soma a nutrição estimada de uma lista de ingredientes { nome, medida } (em português),
// usando a base de dados local. Sempre retorna um resultado (nunca falha por
// causa de internet, chave de API ou limite de requisições).
function estimarNutricaoLocal(ingredientes) {

  const totais = {};
  ORDEM_NUTRIENTES.forEach(chave => totais[chave] = 0);

  let reconhecidos = 0;

  ingredientes.forEach(ing => {

    const nomeEn = traduzirNomeParaBaseNutricional(ing.nome);
    const base = buscarBaseIngrediente(nomeEn);
    if (!base) return;

    reconhecidos++;

    const gramas = estimarGramas(ing.medida);
    const fator = gramas / 100;

    ORDEM_NUTRIENTES.forEach(chave => {
      if (typeof base[chave] === "number") {
        totais[chave] += base[chave] * fator;
      }
    });

  });

  return {
    ok: reconhecidos > 0,
    totais,
    reconhecidos,
    total: ingredientes.length,
  };

}

// Mostra os valores POR PORÇÃO (não o total da receita inteira), porque é
// o que as pessoas esperam ver numa informação nutricional. O total da
// receita é o resultadoNutricao.totais dividido pelo número de porções.
function montarInformacaoNutricional(resultadoNutricao, porcoes) {

  const numPorcoes = porcoes && porcoes > 0 ? porcoes : 1;

  const cabecalho = `
    <h3 class="text-xl mb-3">
        Informações nutricionais <span class="text-muted" style="font-family:'Inter',sans-serif; font-weight:400; font-size:.85rem;">(por porção)</span>
        <span class="text-muted" style="display:block; font-family:'Inter',sans-serif; font-weight:400; font-size:.8rem; margin-top:.2rem;">
          estimativa aproximada${resultadoNutricao && resultadoNutricao.total ? `, baseada em ${resultadoNutricao.reconhecidos} de ${resultadoNutricao.total} ingredientes reconhecidos` : ""}${numPorcoes > 1 ? ` · receita rende ${numPorcoes} porções` : ""}
        </span>
    </h3>
  `;

  if (!resultadoNutricao || !resultadoNutricao.ok) {

    return `
      ${cabecalho}
      <div class="empty-state mb-6" style="padding:1.25rem 1.5rem; text-align:left;">
        <p class="text-muted" style="font-size:.9rem;">Não conseguimos reconhecer os ingredientes desta receita na nossa base nutricional.</p>
      </div>
    `;

  }

  const totais = resultadoNutricao.totais;
  let itens = "";

  ORDEM_NUTRIENTES.forEach(chave => {

    const valor = Math.round((totais[chave] / numPorcoes) * 10) / 10;

    if (valor > 0) {
      itens += `
        <div class="nutrition-item">
          <strong>${valor}${UNIDADES_NUTRIENTES[chave]}</strong>
          <span>${NOMES_NUTRIENTES[chave]}</span>
        </div>
      `;
    }

  });

  if (itens === "") {
    return `
      ${cabecalho}
      <div class="empty-state mb-6" style="padding:1.25rem 1.5rem; text-align:left;">
        <p class="text-muted" style="font-size:.9rem;">Nenhum valor nutricional relevante encontrado para esta receita.</p>
      </div>
    `;
  }

  return `
    ${cabecalho}
    <div class="nutrition-grid mb-6">
        ${itens}
    </div>
  `;

}


// ================= BUSCA LOCAL DE RECEITAS (sem nenhuma API) =================
// Compara os ingredientes digitados pelo usuário com os ingredientes de
// cada receita do banco local, e ranqueia pelo número de ingredientes
// que baterem.
//
// Importante: cada ingrediente digitado pelo usuário só pode "bater" em UM
// ingrediente da receita, e cada ingrediente da receita só pode ser contado
// UMA vez. Isso evita, por exemplo, que digitar só "leite" conte como 2
// ingredientes numa receita que tem "leite" e "leite condensado" ao mesmo
// tempo (são coisas diferentes, mas uma contém a palavra da outra).
function buscarReceitasLocais(ingredientesUsuario) {

  const tokensUsuario = [...new Set(
    ingredientesUsuario.map(normalizarNomeIngrediente).filter(Boolean)
  )];

  const resultados = RECEITAS.map(receita => {

    const nomesIngredientes = receita.ingredientes.map(ing => normalizarNomeIngrediente(ing.nome));
    const indicesJaContados = new Set();
    let usados = 0;

    tokensUsuario.forEach(token => {

      const indiceEncontrado = nomesIngredientes.findIndex((nomeIngrediente, indice) =>
        !indicesJaContados.has(indice) &&
        (nomeIngrediente.includes(token) || token.includes(nomeIngrediente))
      );

      if (indiceEncontrado !== -1) {
        indicesJaContados.add(indiceEncontrado);
        usados++;
      }

    });

    return {
      receita,
      usados,
      faltando: receita.ingredientes.length - usados,
    };

  })
  .filter(r => r.usados > 0)
  .sort((a, b) => b.usados - a.usados || a.faltando - b.faltando);

  return resultados;

}

function capitalizar(texto) {
  if (!texto) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Monta a linha de exibição de um ingrediente. Ingredientes "a gosto" ficam
// mais naturais como "Sal a gosto" em vez de "a gosto de sal".
function formatarLinhaIngrediente(ing) {
  const medida = (ing.medida || "").trim();

  if (/^a gosto$/i.test(medida) || /^opcional$/i.test(medida)) {
    return `${capitalizar(ing.nome)} ${medida}`;
  }

  return `${medida} de ${ing.nome}`;
}

// Monta o HTML dos ingredientes e o modo de preparo (já em português,
// direto do banco local, sem nenhuma tradução envolvida).
function montarDadosReceita(receita) {

  const ingredientesHtml = receita.ingredientes
    .map(ing => `<li>${formatarLinhaIngrediente(ing)}</li>`)
    .join("");

  const passosHtml = receita.modoPreparo
    .map(passo => `<li>${passo}</li>`)
    .join("");

  const resultadoNutricao = estimarNutricaoLocal(receita.ingredientes);
  const nutricaoHtml = montarInformacaoNutricional(resultadoNutricao, receita.porcoes);

  return {
    id: receita.id,
    titulo: receita.titulo,
    categoria: receita.categoria,
    origem: receita.regiao || "",
    porcoes: receita.porcoes || null,
    tempoPreparo: receita.tempoPreparo || "",
    ingredientesHtml,
    passosHtml,
    nutricaoHtml,
  };

}


// ================= RENDERIZAÇÃO =================

// Renderiza uma receita completa, seja ela recém-buscada no banco local ou
// salva nos favoritos.
function renderizarReceita(receita) {
  const favorita = receitaEstaFavoritada(receita.id);

  document.getElementById("resultado").innerHTML = `
    <div class="ticket recipe-detail">

        <div class="recipe-detail-top">
          <div class="recipe-illustration recipe-illustration-detail mb-6">${gerarIlustracaoSvg(receita.categoria)}</div>

          <button
            class="favorite-main-btn ${favorita ? "is-favorite" : ""}"
            onclick="favoritarReceitaAtual()"
            title="${favorita ? "Remover dos favoritos" : "Adicionar aos favoritos"}"
          >
            <span>${favorita ? "♥" : "♡"}</span>
            ${favorita ? "Remover dos favoritos" : "Favoritar receita"}
          </button>
        </div>

        <h2 class="mb-4">${receita.titulo}</h2>

        <div class="recipe-meta ticket-divider" style="border-top:none; padding-top:0;">
            ${receita.categoria ? `
            <div class="item">
                <strong>${receita.categoria}</strong>
                Categoria
            </div>` : ""}
            ${receita.origem ? `
            <div class="item">
                <strong>${receita.origem}</strong>
                Origem
            </div>` : ""}
            ${receita.porcoes ? `
            <div class="item">
                <strong>${receita.porcoes}</strong>
                Porções
            </div>` : ""}
            ${receita.tempoPreparo ? `
            <div class="item">
                <strong>${receita.tempoPreparo}</strong>
                Tempo de preparo
            </div>` : ""}
        </div>

        <hr class="ticket-divider">

        ${receita.nutricaoHtml}

        <h3 class="text-xl mb-3">Ingredientes</h3>
        <ul class="recipe-ingredients mb-6">${receita.ingredientesHtml}</ul>

        <h3 class="text-xl mb-3">Modo de preparo</h3>
        <ol class="recipe-steps mb-8">${receita.passosHtml}</ol>

        <div class="recipe-footer-actions">
          <button onclick="mostrarFavoritos()" class="btn btn-outline">
            ♥ Ver meus favoritos
          </button>

          <button onclick="buscarReceitas()" class="btn btn-outline">
            ← Voltar para os resultados
          </button>
        </div>

    </div>
  `;
}

// ================= NAVEGAÇÃO POR HISTÓRICO (botão Voltar do navegador) =================
// Cada ação de navegação (buscar, abrir receita, ver favoritos) empurra um
// "estado" no histórico do navegador. Assim, o botão Voltar desfaz um passo
// dentro do site (ex: sai da receita e volta pros resultados da busca) em
// vez de sair da página inteira.
function renderizarEstado(estado) {

  if (!estado || estado.tipo === "inicial") {
    document.getElementById("resultado").innerHTML = "";
    return;
  }

  if (estado.tipo === "resultados") {
    renderizarCardsResultados(estado.candidatos);
    return;
  }

  if (estado.tipo === "receita") {
    receitaAtual = estado.dados;
    renderizarReceita(estado.dados);
    return;
  }

  if (estado.tipo === "favoritos") {
    renderizarListaFavoritos();
    return;
  }

}

window.addEventListener("popstate", (evento) => {
  renderizarEstado(evento.state);
});

// ================= RESULTADOS + FILTRO POR CATEGORIA =================
// Guardamos os últimos resultados e a categoria escolhida no filtro, pra
// poder filtrar na hora, sem refazer a busca.
let ultimosCandidatos = [];
let categoriaFiltroAtual = "todas";

function categoriaDoCandidato(candidato) {
  const receita = RECEITAS.find(r => r.id === candidato.id);
  return receita ? receita.categoria : null;
}

// Monta os cards de resultado de busca a partir de uma lista leve
// { id, usados, faltando } — usado tanto numa busca nova quanto ao voltar
// pelo histórico do navegador.
function renderizarCardsResultados(candidatosResumo) {
  ultimosCandidatos = candidatosResumo || [];
  categoriaFiltroAtual = "todas";
  renderizarGradeResultados();
}

window.filtrarPorCategoria = function (categoria) {
  categoriaFiltroAtual = categoria;
  renderizarGradeResultados();
};

function renderizarGradeResultados() {

  if (ultimosCandidatos.length === 0) {
    document.getElementById("resultado").innerHTML = `
      <div class="empty-state">
        <div class="favorite-empty-icon">🍽️</div>
        <h2 class="text-xl mb-2">Nenhuma receita encontrada</h2>
        <p class="text-muted mb-5">
          Tente ingredientes mais simples, como "frango", "ovo", "arroz" ou "batata",
          e confira se estão separados por vírgula.
        </p>
        <button onclick="document.getElementById('ingredientes').focus()" class="btn btn-outline">
          Tentar outros ingredientes
        </button>
      </div>
    `;
    return;
  }

  const categoriasPresentes = [...new Set(
    ultimosCandidatos.map(categoriaDoCandidato).filter(Boolean)
  )];

  const candidatosFiltrados = categoriaFiltroAtual === "todas"
    ? ultimosCandidatos
    : ultimosCandidatos.filter(c => categoriaDoCandidato(c) === categoriaFiltroAtual);

  let filtrosHtml = "";

  if (categoriasPresentes.length > 1) {

    filtrosHtml = `<div class="filter-bar">
      <button class="filter-pill ${categoriaFiltroAtual === "todas" ? "ativo" : ""}"
              onclick="filtrarPorCategoria('todas')">Todas (${ultimosCandidatos.length})</button>`;

    categoriasPresentes.forEach(categoria => {
      const quantidade = ultimosCandidatos.filter(c => categoriaDoCandidato(c) === categoria).length;
      filtrosHtml += `
        <button class="filter-pill ${categoriaFiltroAtual === categoria ? "ativo" : ""}"
                onclick="filtrarPorCategoria('${categoria}')">${categoria} (${quantidade})</button>`;
    });

    filtrosHtml += `</div>`;
  }

  let html = `
    <div class="results-header">
      <h2 class="text-xl">${ultimosCandidatos.length} receita(s) encontrada(s)</h2>
      <p class="text-muted">Ordenadas pelas que mais aproveitam o que você já tem</p>
    </div>
    ${filtrosHtml}
    <div class="results-grid">
  `;

  candidatosFiltrados.forEach(({ id, usados, faltando }) => {

    const receita = RECEITAS.find(r => r.id === id);
    if (!receita) return;

    const visual = CATEGORIA_VISUAL[receita.categoria] || { cor: "#54594C" };
    const total = usados + faltando;
    const percentual = total > 0 ? Math.round((usados / total) * 100) : 0;

    html += `
      <div class="recipe-card" onclick="abrirReceita('${receita.id}')">

          <div class="recipe-illustration">
              ${gerarIlustracaoSvg(receita.categoria)}
              <span class="recipe-badge" style="background:${visual.cor}">${receita.categoria}</span>
          </div>

          <div class="body">

              <h3 class="mb-1">${receita.titulo}</h3>
              ${receita.regiao ? `<p class="recipe-origin mb-3">${receita.regiao}</p>` : `<div class="mb-3"></div>`}

              <div class="match-bar">
                <div class="match-bar-fill" style="width:${percentual}%"></div>
              </div>

              <div class="match-info">
                  <span class="text-forest font-semibold">✓ ${usados} que você tem</span>
                  <span class="text-warn">${faltando} faltando</span>
              </div>

          </div>

      </div>
    `;

  });

  html += `</div>`;

  document.getElementById("resultado").innerHTML = html;

}


// ================= ABRIR RECEITA =================
window.abrirReceita = function (id) {

  const receita = RECEITAS.find(r => r.id === id);

  if (!receita) {
    mostrarAviso("Não foi possível carregar essa receita.", "erro");
    return;
  }

  const dados = montarDadosReceita(receita);

  history.pushState({ tipo: "receita", dados }, "");

  receitaAtual = dados;
  renderizarReceita(dados);

}


// ================= BUSCAR RECEITAS =================
window.buscarReceitas = function () {

  const textoIngredientes =
    document.getElementById("ingredientes").value.trim();

  if (textoIngredientes === "") {
    mostrarAviso("Digite pelo menos um ingrediente antes de buscar.", "erro");
    return;
  }

  const ingredientesUsuario = textoIngredientes
    .split(",")
    .map(i => i.trim())
    .filter(Boolean);

  salvarDespensa(ingredientesUsuario);

  // Feedback visual de "procurando". A busca em si é local e quase instantânea,
  // mas uma pausa curtinha deixa claro pro usuário que algo aconteceu.
  document.getElementById("resultado").innerHTML = `
    <div class="loading-state">
      <div class="loader"></div>
      <p class="text-muted mt-4">Procurando receitas com o que você tem...</p>
    </div>
  `;

  setTimeout(() => {

    const resultadosBusca = buscarReceitasLocais(ingredientesUsuario).slice(0, 12);

    const candidatosResumo = resultadosBusca.map(({ receita, usados, faltando }) => ({
      id: receita.id,
      usados,
      faltando,
    }));

    history.pushState({ tipo: "resultados", candidatos: candidatosResumo }, "");

    renderizarCardsResultados(candidatosResumo);

  }, 400);

}


// ================= VERIFICA SE O USUÁRIO ESTÁ LOGADO =================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  usuarioAtual = user;
  history.replaceState({ tipo: "inicial" }, "");

  await Promise.all([carregarFavoritos(), carregarDespensa()]);
});


// ================= BOTÃO SAIR =================
window.logout = async function () {
  await signOut(auth);
  window.location.href = "index.html";
}
