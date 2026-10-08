import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

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

window.login = async function () {

  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;

  const mensagem = document.getElementById("mensagem");
  if (!email || !senha) {
    mensagem.textContent = "Preencha email e senha.";
    return;
  }

  try {
    mensagem.textContent = "Entrando...";
    await signInWithEmailAndPassword(auth, email, senha);
    window.location.replace("pagina2.html");
  } catch (erro) {
    console.error(erro);
    mensagem.textContent = "Não foi possível entrar. Confira email e senha.";
  }

}

window.cadastrar = async function () {

  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;

  const mensagem = document.getElementById("mensagem");
  if (!email || !senha) {
    mensagem.textContent = "Preencha email e senha.";
    return;
  }
  if (senha.length < 6) {
    mensagem.textContent = "A senha precisa ter pelo menos 6 caracteres.";
    return;
  }

  try {
    mensagem.textContent = "Criando conta...";
    await createUserWithEmailAndPassword(auth, email, senha);
    mensagem.textContent = "Conta criada! Você já pode entrar.";
  } catch (erro) {
    console.error(erro);
    mensagem.textContent = "Não foi possível criar a conta. Verifique os dados.";
  }

}


window.recuperarSenha = async function () {

  const email = document.getElementById("email").value.trim();
  const mensagem = document.getElementById("mensagem");

  if (!email) {
    mensagem.textContent = "Digite seu email no campo acima e clique em \"Esqueci minha senha\" de novo.";
    document.getElementById("email").focus();
    return;
  }

  try {
    mensagem.textContent = "Enviando...";
    await sendPasswordResetEmail(auth, email);
    mensagem.textContent = `Enviamos um link de redefinição para ${email}. Confira sua caixa de entrada (e o spam).`;
  } catch (erro) {
    console.error(erro);
    // Não revela se o email existe ou não na base, por segurança.
    mensagem.textContent = "Não foi possível enviar o email agora. Confira se o email está certo e tente novamente.";
  }

}

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter") window.login();
});
