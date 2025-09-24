// script.js (responsive + mobile menu + original game logic + referrals + Free-Spin feature)
// Behavior:
// - New users get freeSpins = 5 by default on first account creation.
// - Free-Spin appears and works on both desktop and mobile.
// - Clicking a free-spin decrements freeSpins by 1 (Firestore update) and spins the wheel (cost 0).
// - When referralsCount increases, user receives +5 free spins per new referral.
// - Skull.png background is shown only on desktop/laptop (window.innerWidth >= 700)
// - Spin result selection is biased: 99.99% chance to land on "💀" sectors (even though sectors remain 4/4).

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  doc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
  getDoc,
  setDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { logout } from "./auth.js";

// ===== CONFIG =====
const DESKTOP_MIN_WIDTH = 700; // >=700px considered laptop/desktop for skull background
const SKULL_BG_SRC = "./Skull.png"; // filename (relative). Change if your file name/path differs.

// DOM refs
const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const gameWrapper = document.getElementById("gameWrapper") || canvas.parentElement;

const spinBtn = document.getElementById("spinBtn");
const multiSpinBtn = document.getElementById("multiSpinBtn");
const withdrawBtn = document.getElementById("withdrawBtn");
const logoutBtn = document.getElementById("logoutBtn");

const addBalanceBtn = document.getElementById("addBalanceBtn");
const paymentPopup = document.getElementById("paymentInstructions");
const doneBtn = document.getElementById("doneBtn");
const paymentCancel = document.getElementById("paymentCancel");
const userIDSpan = document.getElementById("userID");
const inputAccHolder = document.getElementById("inputAccHolder");
const inputAccNumber = document.getElementById("inputAccNumber");
const inputAmount = document.getElementById("inputAmount");

const popup = document.getElementById("popup");
const popupOkBtn = document.getElementById("popupOkBtn");
const prizeText = document.getElementById("prizeText");

// Mobile header/menu elements
const hamburgerBtn = document.getElementById("hamburgerBtn");
const mobileMenu = document.getElementById("mobileMenu");
const mobileAddBalanceBtn = document.getElementById("mobileAddBalanceBtn");
const mobileWithdrawBtn = document.getElementById("mobileWithdrawBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
const headerBalance = document.getElementById("headerBalance");
const mobileBalance = document.getElementById("mobileBalance");
const mobileEmail = document.getElementById("mobileEmail");

// Referral DOM elements (new)
const referBtn = document.getElementById("referBtn");
const mobileReferBtn = document.getElementById("mobileReferBtn");
const referPopup = document.getElementById("referPopup");
const referClose = document.getElementById("referClose");
const referUserIDEl = document.getElementById("referUserID");
const referralsCountEl = document.getElementById("referralsCount");
const copyReferralBtn = document.getElementById("copyReferralBtn");

// Footer email element (will show current user's email)
const footerEmail = document.getElementById("footerEmail");

// Free spin button refs (desktop + mobile)
let freeSpinBtn = null;
let mobileFreeSpinBtn = null;

// Local state
let balance = 0;
let currentUser = null;
let currentRotationRad = 0;
let freeSpins = 0; // local copy of free spins
let prevReferralsCount = 0; // to detect new referrals
let userDocCreatedByClient = false; // helps prevent race that sets freeSpins to 0 immediately after create

// Preload skull background image (improves perceived performance)
const _skullPreload = new Image();
_skullPreload.src = SKULL_BG_SRC;
_skullPreload.onload = () => { /* loaded */ };

// wheel image & prizes
const wheelImg = new Image();
wheelImg.src = "./Wheel.png";
// Keep sectors 4/4 visually (as requested)
const prizes = ["📱", "💀", "📱", "💀", "📱", "💀", "📱", "💀"];
const SECTOR_COUNT = prizes.length;
const SECTOR_SIZE = 360 / SECTOR_COUNT;
const sectors = [];
for (let i = 0; i < SECTOR_COUNT; i++) {
  const start = i * SECTOR_SIZE;
  const end = start + SECTOR_SIZE;
  const center = (start + end) / 2;
  sectors.push({ prize: prizes[i], startDeg: start, endDeg: end, centerDeg: center });
}

/* ==========================
   Spin sound setup
   ========================== */
if (!window.__spinSound) {
  try {
    const a = new Audio('./wheel.mp3');
    a.preload = 'auto';
    a.volume = 1.0;
    a.loop = false;
    window.__spinSound = a;
  } catch (e) {
    window.__spinSound = null;
  }
}
const spinSound = window.__spinSound || null;

/* ==========================
   PICK PRIZE HELPER (weighted / biased)
   ========================== */
/**
 * Returns an index between 0..SECTOR_COUNT-1.
 * Behavior: 99.99% chance return an index that's a "💀" sector,
 * 0.01% chance return a non-💀 sector. Within each group pick randomly.
 */
function pickPrizeIndex() {
  // gather indexes
  const skullIndexes = [];
  const nonSkullIndexes = [];
  for (let i = 0; i < SECTOR_COUNT; i++) {
    if (prizes[i] && String(prizes[i]).includes('💀')) skullIndexes.push(i);
    else nonSkullIndexes.push(i);
  }

  // safety: if no skull found or none other, fallback to uniform random
  if (skullIndexes.length === 0 || nonSkullIndexes.length === 0) {
    return Math.floor(Math.random() * SECTOR_COUNT);
  }

  // bias: probability of skull (0.9999)
  const skullProb = 1.0;
  if (Math.random() < skullProb) {
    // pick random skull index
    return skullIndexes[Math.floor(Math.random() * skullIndexes.length)];
  } else {
    // rare success for non-skull
    return nonSkullIndexes[Math.floor(Math.random() * nonSkullIndexes.length)];
  }
}

/* ==========================
   Skull background helpers
   ========================== */
function applySkullBackground() {
  document.body.style.backgroundImage = `url('${SKULL_BG_SRC}')`;
  document.body.style.backgroundRepeat = "no-repeat";
  document.body.style.backgroundPosition = "center center";
  document.body.style.backgroundSize = "cover";
  document.body.classList.add("has-skull-bg");
}
function removeSkullBackground() {
  document.body.style.backgroundImage = "none";
  document.body.classList.remove("has-skull-bg");
}
function updateSkullBackgroundByWidth() {
  if (window.innerWidth >= DESKTOP_MIN_WIDTH) applySkullBackground();
  else removeSkullBackground();
}

/* ===== responsive canvas helpers ===== */
function resizeCanvasToContainer() {
  const rect = gameWrapper ? gameWrapper.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
  const cssSide = Math.max(80, Math.floor(Math.min(rect.width, rect.height)));
  const cssW = Math.min(rect.width, 700);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const finalCssWidth = window.innerWidth < 700 ? Math.min(window.innerWidth - 24, 600) : Math.min(500, cssW);

  canvas.style.width = finalCssWidth + "px";
  canvas.style.height = finalCssWidth + "px";

  canvas.width = Math.round(finalCssWidth * dpr);
  canvas.height = Math.round(finalCssWidth * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  drawWheel(currentRotationRad);

  // Ensure freeSpin button sizing/visibility after resize
  ensureFreeSpinButtonAppearance();

  // Desktop-only skull background toggle (JS safeguard)
  updateSkullBackgroundByWidth();
}
window.addEventListener("resize", debounce(resizeCanvasToContainer, 120));
window.addEventListener("orientationchange", () => setTimeout(resizeCanvasToContainer, 120));
window.addEventListener("load", () => {
  setTimeout(() => {
    updateSkullBackgroundByWidth();
    resizeCanvasToContainer();
  }, 20);
});
wheelImg.onload = () => resizeCanvasToContainer();

function debounce(fn, wait = 80) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ===== drawing =====
function clearCanvas() {
  const cssW = parseFloat(canvas.style.width) || canvas.clientWidth || 500;
  const cssH = parseFloat(canvas.style.height) || canvas.clientHeight || 500;
  ctx.clearRect(0, 0, cssW, cssH);
}
function drawWheel(rotationRad = 0) {
  currentRotationRad = rotationRad;
  clearCanvas();
  const cssW = parseFloat(canvas.style.width) || canvas.clientWidth || 500;
  const cssH = parseFloat(canvas.style.height) || canvas.clientHeight || 500;

  ctx.save();
  ctx.translate(cssW / 2, cssH / 2);
  ctx.rotate(rotationRad);
  if (wheelImg.complete && wheelImg.naturalWidth) {
    ctx.drawImage(wheelImg, -cssW / 2, -cssH / 2, cssW, cssH);
  } else {
    const radius = Math.min(cssW, cssH) / 2;
    for (let i = 0; i < SECTOR_COUNT; i++) {
      ctx.beginPath();
      ctx.moveTo(0,0);
      ctx.arc(0,0,radius,(i*SECTOR_SIZE)*Math.PI/180,((i+1)*SECTOR_SIZE)*Math.PI/180);
      ctx.closePath();
      ctx.fillStyle = i%2===0 ? "#fff" : "rgba(6,52,236,0.06)";
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawRedDot(rotationRad, centerDeg) {
  const cssW = parseFloat(canvas.style.width) || canvas.clientWidth || 500;
  const cssH = parseFloat(canvas.style.height) || canvas.clientHeight || 500;
  const radius = Math.min(cssW, cssH) / 2;
  const dotDistance = radius - 18;

  ctx.save();
  ctx.translate(cssW / 2, cssH / 2);
  const centerRad = (centerDeg * Math.PI) / 180;
  ctx.rotate(rotationRad + centerRad);
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(0, -dotDistance, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function getSectorIndexFromStopDegrees(finalDegrees) {
  let deg = finalDegrees % 360;
  if (deg < 0) deg += 360;
  const wheelDegrees = (360 - deg) % 360;
  let index = Math.floor(wheelDegrees / SECTOR_SIZE);
  index = ((index % SECTOR_COUNT) + SECTOR_COUNT) % SECTOR_COUNT;
  return index;
}

// ===== Firebase balance helpers =====
async function saveBalance() {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, { balance });
  } catch {
    await setDoc(userRef, { email: currentUser.email, balance }, { merge: true });
  }
}
function updateUserInfoDisplay() {
  if (headerBalance) headerBalance.textContent = `Rs: ${balance}`;
  if (mobileBalance) mobileBalance.textContent = `Rs: ${balance}`;
  if (mobileEmail) mobileEmail.textContent = currentUser ? currentUser.email : '...';
  if (userIDSpan) userIDSpan.textContent = currentUser ? currentUser.uid : '...';
  if (footerEmail) footerEmail.textContent = currentUser ? currentUser.email : '...';
  if (referUserIDEl) referUserIDEl.textContent = currentUser ? currentUser.uid : '...';

  // update freeSpin button label if exists
  updateFreeSpinDisplay();
}

// ===== Free-Spin: UI & Logic =====
async function useFreeSpin() {
  if (!currentUser) { showStatus("⚠️ Please login first!", "error"); return; }
  if ((freeSpins || 0) <= 0) { showStatus("⚠️ No free spins available!", "error"); return; }

  disableAllSpinButtons(true);

  try {
    const userRef = doc(db, "users", currentUser.uid);
    const newFree = Math.max(0, (freeSpins || 0) - 1);
    try {
      await updateDoc(userRef, { freeSpins: newFree });
    } catch (err) {
      console.error("Failed to update freeSpins in Firestore:", err);
    }
    freeSpins = newFree;
    updateFreeSpinDisplay();

    const prize = await spinWheel(0);
    if (prize) showPrize("🎁 You got: " + prize);
  } catch (err) {
    console.error("Failed to use free spin:", err);
    showStatus("❌ Unable to use free spin right now.", "error");
  } finally {
    disableAllSpinButtons(false);
  }
}

function ensureFreeSpinButton() {
  if (!freeSpinBtn) {
    freeSpinBtn = document.getElementById("freeSpinBtn");
    if (!freeSpinBtn) {
      freeSpinBtn = document.createElement("button");
      freeSpinBtn.id = "freeSpinBtn";
      freeSpinBtn.type = "button";
      freeSpinBtn.className = "";
      freeSpinBtn.textContent = `Free-Spin: ${freeSpins || 0}`;
      freeSpinBtn.addEventListener("click", useFreeSpin);

      const insertAfter = multiSpinBtn || spinBtn;
      if (insertAfter && insertAfter.parentElement) {
        insertAfter.parentElement.insertBefore(freeSpinBtn, insertAfter.nextSibling);
      } else {
        const bg = document.querySelector(".button-group");
        if (bg) bg.appendChild(freeSpinBtn);
        else document.body.appendChild(freeSpinBtn);
      }
    }
  }

  if (mobileMenu) {
    const mobileActions = mobileMenu.querySelector(".mobile-actions");
    if (mobileActions && !mobileFreeSpinBtn) {
      mobileFreeSpinBtn = document.getElementById("mobileFreeSpinBtn");
      if (!mobileFreeSpinBtn) {
        mobileFreeSpinBtn = document.createElement("button");
        mobileFreeSpinBtn.id = "mobileFreeSpinBtn";
        mobileFreeSpinBtn.type = "button";
        mobileFreeSpinBtn.className = "";
        mobileFreeSpinBtn.style.marginTop = "6px";
        mobileFreeSpinBtn.addEventListener("click", () => {
          try { toggleMobileMenu(); } catch(e){}
          useFreeSpin();
        });
        mobileActions.appendChild(mobileFreeSpinBtn);
      }
    }
  }

  try {
    const refBtn = spinBtn || multiSpinBtn || document.querySelector("button");
    if (refBtn) {
      const style = window.getComputedStyle(refBtn);
      const bg = style.backgroundColor || style.background;
      if (bg) {
        freeSpinBtn.style.background = bg;
        if (mobileFreeSpinBtn) mobileFreeSpinBtn.style.background = bg;
      }
      freeSpinBtn.style.color = style.color;
      freeSpinBtn.style.padding = style.padding;
      freeSpinBtn.style.fontSize = style.fontSize;
      if (mobileFreeSpinBtn) {
        mobileFreeSpinBtn.style.color = style.color;
        mobileFreeSpinBtn.style.padding = style.padding;
        mobileFreeSpinBtn.style.fontSize = style.fontSize;
        mobileFreeSpinBtn.style.width = "100%";
        mobileFreeSpinBtn.style.boxSizing = "border-box";
      }
    }
  } catch (e) {}

  ensureFreeSpinButtonAppearance();
}

function updateFreeSpinDisplay() {
  if (freeSpinBtn) freeSpinBtn.textContent = `Free-Spin: ${freeSpins || 0}`;
  if (mobileFreeSpinBtn) mobileFreeSpinBtn.textContent = `Free-Spin: ${freeSpins || 0}`;
  ensureFreeSpinButtonAppearance();
}

function ensureFreeSpinButtonAppearance() {
  if (!freeSpinBtn && !mobileFreeSpinBtn) return;
  if (freeSpinBtn) {
    try {
      freeSpinBtn.style.display = "inline-block";
      const refBtn = spinBtn || multiSpinBtn;
      if (refBtn) {
        const refWidth = refBtn.getBoundingClientRect().width;
        if (refWidth) freeSpinBtn.style.minWidth = Math.max(80, Math.floor(refWidth)) + "px";
      }
      freeSpinBtn.style.borderRadius = "10px";
    } catch (e){}
  }
  if (mobileFreeSpinBtn) {
    mobileFreeSpinBtn.style.display = "block";
    mobileFreeSpinBtn.style.borderRadius = "10px";
    mobileFreeSpinBtn.style.width = "100%";
    mobileFreeSpinBtn.style.boxSizing = "border-box";
  }
}

function disableAllSpinButtons(disabled) {
  try { if (spinBtn) spinBtn.disabled = disabled; } catch {}
  try { if (multiSpinBtn) multiSpinBtn.disabled = disabled; } catch {}
  try { if (freeSpinBtn) freeSpinBtn.disabled = disabled; } catch {}
  try { if (mobileFreeSpinBtn) mobileFreeSpinBtn.disabled = disabled; } catch {}
}

/* ======== UPDATED spinWheel: decide target index via pickPrizeIndex() ======== */
async function spinWheel(cost = 10) {
  if (cost > 0 && balance < cost) {
    showStatus("⚠️ Not enough balance!", "error"); return null;
  }
  if (cost > 0) {
    balance -= cost;
    updateUserInfoDisplay();
    try { await saveBalance(); } catch {}
  }

  return new Promise((resolve) => {
    // determine target sector index using biased picker
    const targetIdx = pickPrizeIndex();
    const targetCenterDeg = sectors[targetIdx].centerDeg; // center angle of target sector

    // compute finalDegrees so that getSectorIndexFromStopDegrees(finalDegrees) => targetIdx
    // Formula: wheelDegrees = centerDeg, and wheelDegrees = (360 - deg) % 360 => deg = (360 - centerDeg) % 360
    let desiredDeg = (360 - targetCenterDeg) % 360;

    // add small jitter to avoid perfectly centered stop (still stays in same sector)
    const jitterRange = SECTOR_SIZE * 0.3; // up to ±30% of sector size
    const jitter = (Math.random() - 0.5) * jitterRange;
    desiredDeg = (desiredDeg + jitter + 360) % 360;

    const rounds = 6 + Math.floor(Math.random() * 3); // full rotations
    const spinAngle = rounds * 360 + desiredDeg;
    const spinTimeTotal = 3000 + Math.floor(Math.random() * 600); // ms (slight randomness)
    const startTime = performance.now();

    if (spinSound) {
      try {
        spinSound.loop = true;
        spinSound.currentTime = 0;
        const p = spinSound.play();
        if (p && typeof p.catch === 'function') p.catch(()=>{/* ignore */});
      } catch (e) {}
    }

    function step(now) {
      const spinTime = now - startTime;
      const t = Math.min(spinTime, spinTimeTotal);
      const easeOut = (t, b, c, d) => c * ((t = t / d - 1) * t * t + 1) + b;
      const currentAngle = easeOut(t, 0, spinAngle, spinTimeTotal);
      const rotationRad = (currentAngle * Math.PI) / 180;
      drawWheel(rotationRad);

      if (spinTime < spinTimeTotal) {
        requestAnimationFrame(step); return;
      }

      if (spinSound) {
        try {
          spinSound.pause();
          spinSound.currentTime = 0;
          spinSound.loop = false;
        } catch (e) { /* ignore */ }
      }

      const finalDegrees = spinAngle % 360;
      const idx = getSectorIndexFromStopDegrees(finalDegrees);
      const prize = prizes[idx];
      const prizeVal = parseInt(prize);
      if (!isNaN(prizeVal) && prizeVal > 0) {
        balance += prizeVal;
        updateUserInfoDisplay();
        saveBalance().catch(()=>{});
      }

      const finalRotationRad = (spinAngle * Math.PI)/180;
      drawWheel(finalRotationRad);
      const centerDeg = sectors[idx].centerDeg;
      drawRedDot(finalRotationRad, centerDeg);

      resolve(prize);
    }
    requestAnimationFrame(step);
  });
}

// ===== Button handlers =====
spinBtn?.addEventListener("click", async () => {
  spinBtn.disabled = true;
  try {
    const prize = await spinWheel(100);
    if (prize) showPrize("🎁 You got: " + prize);
  } finally { spinBtn.disabled = false; }
});

multiSpinBtn?.addEventListener("click", async () => {
  if (balance < 1000) { showStatus("⚠️ Not enough balance!", "error"); return; }
  multiSpinBtn.disabled = true;
  spinBtn.disabled = true;
  balance -= 1000;
  updateUserInfoDisplay();
  try { await saveBalance(); } catch {}
  const results = [];
  try {
    for (let i=0;i<1;i++){
      const prize = await spinWheel(0);
      if (prize) results.push(prize);
      await new Promise(r=>setTimeout(r,160));
    }
    showPrize("🎁 You got:\n" + results.join(", "));
  } finally {
    multiSpinBtn.disabled = false;
    spinBtn.disabled = false;
  }
});

// ===== Add-balance popup handling =====
function ensureAddBalancePopupListeners() {
  if (!addBalanceBtn || !paymentPopup || !doneBtn || !userIDSpan) return;

  const openPayment = () => {
    if (!currentUser) { showStatus("⚠️ Please login first!", "error"); return; }
    userIDSpan.textContent = currentUser.uid;
    paymentPopup.style.display = "flex";
    paymentPopup.setAttribute("aria-hidden", "false");
  };

  addBalanceBtn.addEventListener("click", openPayment);
  if (mobileAddBalanceBtn) mobileAddBalanceBtn.addEventListener("click", () => { openPayment(); toggleMobileMenu(); });

  doneBtn.addEventListener("click", async () => {
    const user = currentUser;
    if (!user) { showStatus("⚠️ Please login first!", "error"); return; }
    const accHolder = inputAccHolder ? inputAccHolder.value.trim() : "";
    const accNumber = inputAccNumber ? inputAccNumber.value.trim() : "";
    // parseInt second argument must be radix (100). Trim value to be safe.
    const amount = inputAmount ? parseInt((inputAmount.value || "").trim(), 10) : NaN;

    // Use minimum 10 (change this number here if you prefer 10)
    const MIN_PAYMENT = 10;

    if (!accHolder || !accNumber || isNaN(amount) || amount < MIN_PAYMENT) {
      showStatus(`⚠️ Please Enter Minimum Rs: ${MIN_PAYMENT} `, "error");
      return;
    }


    doneBtn.disabled = true; doneBtn.textContent = "Submitting...";
    try {
      await addDoc(collection(db, "payments"), {
        uid: user.uid, email: user.email || "", accountHolder: accHolder, accountNumber: accNumber,
        amount, method: "Easypaisa", status: "pending", createdAt: serverTimestamp()
      });
      paymentPopup.style.display = "none";
      if (inputAccHolder) inputAccHolder.value = "";
      if (inputAccNumber) inputAccNumber.value = "";
      if (inputAmount) inputAmount.value = "";
      showStatus("✅ Payment request submitted! Await admin verification.", "success");
    } catch (err) {
      console.error(err); showStatus("❌ Failed to submit payment request.", "error");
    } finally { doneBtn.disabled = false; doneBtn.textContent = "Done"; }
  });

  paymentCancel?.addEventListener("click", () => {
    paymentPopup.style.display = "none";
    paymentPopup.setAttribute("aria-hidden", "true");
  });

  window.addEventListener("click", (e) => {
    if (paymentPopup && e.target === paymentPopup) {
      paymentPopup.style.display = "none";
      paymentPopup.setAttribute("aria-hidden", "true");
    }
  });
}

// ===== Withdraw modal (same) =====
function ensureWithdrawModal() {
  if (document.getElementById("withdrawModal")) return;
  const modalOverlay = document.createElement("div");
  modalOverlay.id = "withdrawModal";
  modalOverlay.style.position = "fixed";
  modalOverlay.style.top = "0"; modalOverlay.style.left = "0";
  modalOverlay.style.width = "100%"; modalOverlay.style.height = "100%";
  modalOverlay.style.background = "rgba(0,0,0,0.5)";
  modalOverlay.style.display = "flex";
  modalOverlay.style.alignItems = "center";
  modalOverlay.style.justifyContent = "center";
  modalOverlay.style.zIndex = "3000";
  modalOverlay.style.visibility = "hidden";

  const box = document.createElement("div");
  box.style.background = "#fff"; box.style.padding = "18px"; box.style.borderRadius = "10px";
  box.style.minWidth = "300px"; box.style.boxShadow = "0 6px 20px rgba(0,0,0,0.2)";
  box.style.textAlign = "left"; box.style.color = "#000";

  box.innerHTML = `
    <h3 style="margin:0 0 10px 0; color:#143ad3;">Enter Account Details</h3>
    <div style="margin-bottom:10px;">
      <label style="font-weight:600;">Account Holder's Name</label>
      <input id="withdrawHolderInput" type="text" placeholder="Enter Full Name" style="width:100%; padding:8px; margin-top:6px; border-radius:8px; border:1px solid #ccc;">
    </div>
    <div style="margin-bottom:10px;">
      <label style="font-weight:600;">Easypaisa Account Number</label>
      <input id="withdrawNumberInput" type="text" placeholder="03XXXXXXXXX" style="width:100%; padding:8px; margin-top:6px; border-radius:8px; border:1px solid #ccc;">
    </div>
    <div style="margin-bottom:10px;">
      <label style="font-weight:600;">Enter Amount</label>
      <input id="withdrawAmountInput" type="number" min="1000" placeholder="Minimum 1000" style="width:100%; padding:8px; margin-top:6px; border-radius:8px; border:1px solid #ccc;">
    </div>
    <div id="withdrawError" style="color:#721c24; display:none; margin-bottom:8px;"></div>
    <div style="display:flex; gap:8px; justify-content:flex-end;">
      <button id="withdrawCancelBtn" style="padding:8px 12px; border-radius:8px; border:none; background:#ccc; cursor:pointer;">Cancel</button>
      <button id="withdrawSubmitBtn" style="padding:8px 12px; border-radius:8px; border:none; background:#e14a3c; color:#fff; cursor:pointer;">Submit</button>
    </div>
  `;
  modalOverlay.appendChild(box);
  document.body.appendChild(modalOverlay);

  document.getElementById("withdrawCancelBtn").addEventListener("click", hideWithdrawModal);

  document.getElementById("withdrawSubmitBtn").addEventListener("click", async () => {
    const holder = document.getElementById("withdrawHolderInput").value.trim();
    const number = document.getElementById("withdrawNumberInput").value.trim();
    const input = document.getElementById("withdrawAmountInput");
    const value = parseInt(input.value, 10);
    const errDiv = document.getElementById("withdrawError");

    if (!holder) { errDiv.textContent = "⚠️ Please enter account holder's name."; errDiv.style.display = "block"; return; }
    if (!number) { errDiv.textContent = "⚠️ Please enter account number."; errDiv.style.display = "block"; return; }
    if (!value || value < 1000) { errDiv.textContent = "⚠️ Amount must be at least 1000 PKR."; errDiv.style.display = "block"; return; }
    if (!currentUser) { errDiv.textContent = "⚠️ Please login first."; errDiv.style.display = "block"; return; }
    if (value > balance) { errDiv.textContent = "⚠️ You do not have enough balance."; errDiv.style.display = "block"; return; }

    try {
      const q = query(collection(db, "withdrawals"), where("uid", "==", currentUser.uid), where("status", "==", "pending"));
      const snap = await getDocs(q);
      if (!snap.empty) { errDiv.textContent = "⚠️ You already have a pending withdrawal request."; errDiv.style.display = "block"; return; }
    } catch (err) {
      console.error(err); errDiv.textContent = "❌ Unable to check pending withdrawals."; errDiv.style.display = "block"; return;
    }

    const submitBtn = document.getElementById("withdrawSubmitBtn");
    submitBtn.disabled = true; submitBtn.textContent = "Submitting...";

    try {
      await addDoc(collection(db, "withdrawals"), {
        uid: currentUser.uid, email: currentUser.email, accountHolder: holder, accountNumber: number,
        amount: value, status: "pending", createdAt: serverTimestamp()
      });
      hideWithdrawModal();
      showStatus(`✅ Withdraw request submitted for ${value} PKR.`, "success");
    } catch (err) {
      console.error(err); errDiv.textContent = "❌ Failed to submit withdraw request."; errDiv.style.display = "block";
    } finally { submitBtn.disabled = false; submitBtn.textContent = "Submit"; }
  });

  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hideWithdrawModal(); });
}

function showWithdrawModal(){ ensureWithdrawModal(); const m = document.getElementById("withdrawModal"); if(!m) return; m.style.visibility = "visible"; const h=document.getElementById("withdrawHolderInput"); const n=document.getElementById("withdrawNumberInput"); const a=document.getElementById("withdrawAmountInput"); if(h)h.value=''; if(n) n.value=''; if(a) a.value=''; const err=document.getElementById("withdrawError"); if(err){ err.style.display='none'; err.textContent=''; } }
function hideWithdrawModal(){ const m=document.getElementById("withdrawModal"); if(!m) return; m.style.visibility='hidden'; }
withdrawBtn?.addEventListener("click", () => { if(!currentUser){ showStatus("⚠️ Please login first!","error"); return; } showWithdrawModal(); });
if (mobileWithdrawBtn) mobileWithdrawBtn.addEventListener("click", () => { if(!currentUser){ showStatus("⚠️ Please login first!","error"); return; } showWithdrawModal(); });

// ===== Logout =====
logoutBtn?.addEventListener("click", () => logout());
mobileLogoutBtn?.addEventListener("click", () => logout());

// ===== Auth state & Firestore sync =====
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      try {
        await setDoc(userRef, { email: user.email || "", balance: 0, referralsCount: 0, freeSpins: 1 }, { merge: true });
        freeSpins = 1;
        balance = 0;
        prevReferralsCount = 0;
        userDocCreatedByClient = true;
        updateUserInfoDisplay();
        setTimeout(() => { userDocCreatedByClient = false; }, 1200);
      } catch (err) {
        console.error("Failed to create user doc with default free spins:", err);
        freeSpins = 1; balance = 0; prevReferralsCount = 0; updateUserInfoDisplay();
      }
    } else {
      const data = snap.data() || {};
      balance = data.balance || 0;
      if (typeof data.freeSpins === 'number') freeSpins = data.freeSpins;
      else {
        freeSpins = 1;
        try { await updateDoc(userRef, { freeSpins }); } catch(e){}
      }
      prevReferralsCount = data.referralsCount || 0;
    }
    updateUserInfoDisplay();

    onSnapshot(userRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data() || {};
      balance = typeof data.balance === 'number' ? data.balance : balance;
      const refs = typeof data.referralsCount === 'number' ? data.referralsCount : prevReferralsCount;
      const serverFreeSpins = (typeof data.freeSpins === 'number') ? data.freeSpins : undefined;

      const delta = refs - (prevReferralsCount || 0);
      if (delta > 0) {
        (async () => {
          try {
            const add = delta * 1;
            const base = (typeof serverFreeSpins === 'number') ? serverFreeSpins : (freeSpins || 0);
            const newVal = base + add;
            await updateDoc(userRef, { freeSpins: newVal });
          } catch (err) {
            console.error("Failed to add free spins for new referrals:", err);
          }
        })();
      }

      if (userDocCreatedByClient) {
        if (typeof serverFreeSpins === 'number' && serverFreeSpins !== freeSpins) {
          freeSpins = serverFreeSpins;
        }
      } else {
        if (typeof serverFreeSpins === 'number') {
          freeSpins = serverFreeSpins;
        }
      }

      prevReferralsCount = refs;
      updateUserInfoDisplay();
      if (referralsCountEl) referralsCountEl.textContent = refs;
      if (referUserIDEl) referUserIDEl.textContent = currentUser ? currentUser.uid : '...';
    }, (err) => {
      console.error("onSnapshot user error:", err);
    });
  } else {
    currentUser = null;
    if (headerBalance) headerBalance.textContent = `Rs: 0`;
    if (mobileBalance) mobileBalance.textContent = `Rs: 0`;
    if (mobileEmail) mobileEmail.textContent = '...';
    if (userIDSpan) userIDSpan.textContent = '...';
    if (footerEmail) footerEmail.textContent = '...';
    if (referralsCountEl) referralsCountEl.textContent = '0';
    if (referUserIDEl) referUserIDEl.textContent = '...';
    freeSpins = 0;
    prevReferralsCount = 0;
    updateUserInfoDisplay();
  }

  ensureFreeSpinButton();
});

// ===== Refer popup logic =====
function ensureReferPopupListeners() {
  if (!referBtn && !mobileReferBtn) return;

  const openRefer = async () => {
    if (!currentUser) { showStatus("⚠️ Please login first!", "error"); return; }

    if (referUserIDEl) referUserIDEl.textContent = currentUser.uid;

    try {
      const udoc = await getDoc(doc(db, "users", currentUser.uid));
      const data = udoc.exists() ? udoc.data() : {};
      const refs = data.referralsCount || 0;
      if (referralsCountEl) referralsCountEl.textContent = refs;
    } catch (err) {
      console.error("Failed to fetch referralsCount:", err);
      if (referralsCountEl) referralsCountEl.textContent = '0';
    }

    if (referPopup) {
      referPopup.style.display = "flex";
      referPopup.setAttribute("aria-hidden", "false");
    }
  };

  if (referBtn) referBtn.addEventListener("click", openRefer);
  if (mobileReferBtn) mobileReferBtn.addEventListener("click", () => { openRefer(); toggleMobileMenu(); });

  if (referClose) referClose.addEventListener("click", () => {
    if (referPopup) { referPopup.style.display = "none"; referPopup.setAttribute("aria-hidden", "true"); }
  });

  window.addEventListener("click", (e) => {
    if (referPopup && e.target === referPopup) {
      referPopup.style.display = "none";
      referPopup.setAttribute("aria-hidden", "true");
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (referPopup) { referPopup.style.display = "none"; referPopup.setAttribute("aria-hidden", "true"); }
    }
  });

  if (copyReferralBtn) {
    copyReferralBtn.addEventListener("click", async () => {
      if (!currentUser) { showStatus("⚠️ Please login first!", "error"); return; }
      const base = "https://adil-hayyat.github.io/Skull-Spin/auth.html";
      const referralLink = `${base}?ref=${encodeURIComponent(currentUser.uid)}`;

      const origText = copyReferralBtn.textContent;
      copyReferralBtn.disabled = true;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(referralLink);
        } else {
          const ta = document.createElement("textarea");
          ta.value = referralLink;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        copyReferralBtn.textContent = "Copied!";
        showStatus("✅ Referral link copied to clipboard!", "success");
      } catch (err) {
        console.error("Copy failed:", err);
        showStatus("❌ Failed to copy link. Please copy manually: " + referralLink, "error");
        try { window.prompt("Copy this link (Ctrl/Cmd+C):", referralLink); } catch(e){}
      } finally {
        setTimeout(() => {
          try { copyReferralBtn.textContent = origText; copyReferralBtn.disabled = false; } catch(e){}
        }, 1500);
      }
    });
  }
}

// ===== UI helpers =====
function showPrize(text){ if(prizeText) prizeText.textContent = text; if(popup) { popup.style.display = 'flex'; popup.setAttribute('aria-hidden','false'); } }
function closePopup(){ if(popup) { popup.style.display = 'none'; popup.setAttribute('aria-hidden','true'); } }
window.closePopup = closePopup;
popupOkBtn?.addEventListener('click', closePopup);

function showStatus(message, type){
  let statusBox = document.getElementById("statusMessage");
  if(!statusBox){ statusBox = document.createElement("div"); statusBox.id = "statusMessage"; document.body.appendChild(statusBox); }
  statusBox.textContent = message;
  statusBox.style.display = "block";
  statusBox.style.background = type === "success" ? "#28a745" : "#dc3545";
  statusBox.style.color = "#fff";
  setTimeout(()=>{ statusBox.style.display='none'; }, 4000);
}

// ===== Mobile menu toggle =====
let mobileOpen = false;
function toggleMobileMenu(){
  mobileOpen = !mobileOpen;
  if(mobileOpen){
    if(mobileMenu) { mobileMenu.style.display = 'block'; mobileMenu.setAttribute('aria-hidden','false'); }
    hamburgerBtn?.classList.add('open');
  } else {
    if(mobileMenu) { mobileMenu.style.display = 'none'; mobileMenu.setAttribute('aria-hidden','true'); }
    hamburgerBtn?.classList.remove('open');
  }
}
hamburgerBtn?.addEventListener('click', toggleMobileMenu);

if (mobileAddBalanceBtn) mobileAddBalanceBtn.addEventListener('click', () => { addBalanceBtn?.click(); toggleMobileMenu(); });
if (mobileWithdrawBtn) mobileWithdrawBtn.addEventListener('click', () => { withdrawBtn?.click(); toggleMobileMenu(); });

// ===== Prevent touch scroll while interacting with canvas =====
canvas.addEventListener('pointerdown', (e) => { if (e.isPrimary) e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ===== init =====
ensureAddBalancePopupListeners();
ensureWithdrawModal();
ensureReferPopupListeners();
ensureFreeSpinButton();
resizeCanvasToContainer();

document.addEventListener("DOMContentLoaded", () => {
  const referPopup = document.getElementById("referPopup");
  const referCancelBtn = document.getElementById("referCancel");

  if (referPopup && referCancelBtn) {
    referCancelBtn.addEventListener("click", () => {
      referPopup.style.display = "none";
    });
  }
});

