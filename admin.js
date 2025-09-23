import { db } from "./firebase-config.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const withdrawTable = document.getElementById("withdrawTable");

// 🔥 Load withdrawal requests
const q = query(collection(db, "withdrawals"), orderBy("createdAt", "desc"));
onSnapshot(q, async (snapshot) => {
  withdrawTable.innerHTML = "";
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();

    // User ka email fetch karo
    let email = "Unknown";
    if (data.uid) {
      const userRef = doc(db, "users", data.uid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        email = userDoc.data().email;
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${email}</td>
      <td>${data.amount} PKR</td>
      <td>${data.status}</td>
      <td>${data.createdAt?.toDate().toLocaleString() || "N/A"}</td>
      <td>
        ${
          data.status === "pending"
            ? `
          <button class="approve" data-id="${docSnap.id}" data-uid="${data.uid}" data-amount="${data.amount}">Approve</button>
          <button class="reject" data-id="${docSnap.id}">Reject</button>
          `
            : "✅ Processed"
        }
      </td>
    `;
    withdrawTable.appendChild(tr);
  }

  // 🎯 Approve button
  document.querySelectorAll(".approve").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const uid = btn.getAttribute("data-uid");
      const amount = parseInt(btn.getAttribute("data-amount"), 10);

      const userRef = doc(db, "users", uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        let balance = userDoc.data().balance || 0;

        if (balance >= amount) {
          await updateDoc(userRef, { balance: balance - amount });
          await updateDoc(doc(db, "withdrawals", id), { status: "approved" });
          alert("✅ Withdraw approved & balance updated!");
        } else {
          alert("❌ User does not have enough balance!");
        }
      }
    });
  });

  // 🎯 Reject button
  document.querySelectorAll(".reject").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await updateDoc(doc(db, "withdrawals", id), { status: "rejected" });
      alert("❌ Withdraw request rejected!");
    });
  });
});
