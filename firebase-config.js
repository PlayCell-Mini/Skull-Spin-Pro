import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAE6IddcAPdAUe4J_UywUSBQ2d060yDmPU",
  authDomain: "one-wheely.firebaseapp.com",
  projectId: "one-wheely",
  storageBucket: "one-wheely.appspot.com",
  messagingSenderId: "232397481240",
  appId: "1:232397481240:web:9737c7e1c1ff1c2721ea6d",
  measurementId: "G-626PW7BMSZ"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log("✅ Firebase Connected");
