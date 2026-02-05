const APPS = [
  {
    id: 1,
    name: "BudgetXT",
    desc: "Simple, powerful budget tracking and financial planning for everyday use",
    price: "14.99",
    icon: "💰",
    status: "available"
  },
  {
    id: 2,
    name: "AgendaXT",
    desc: "Smart daily planning with focus blocks, reminders, and clean schedules",
    price: "19.99",
    icon: "🗓️",
    status: "coming-soon"
  },
  {
    id: 3,
    name: "InventoryXT",
    desc: "Simple inventory tracking with low-stock alerts and quick exports",
    price: "29.99",
    icon: "📦",
    status: "coming-soon"
  },
  {
    id: 4,
    name: "FileSorterXT",
    desc: "Organize files automatically with rules, tags, and smart cleanup",
    price: "14.99",
    icon: "🗂️",
    status: "coming-soon"
  },
  {
    id: 5,
    name: "BookedXT",
    desc: "Client booking, calendar sync, and payments in one place",
    price: "24.99",
    icon: "📅",
    status: "coming-soon"
  },
  {
    id: 6,
    name: "PanicXT",
    desc: "Instant emergency checklists and one-tap safety actions",
    price: "11.99",
    icon: "🚨",
    status: "coming-soon"
  },
  {
    id: 7,
    name: "RoccoXT",
    desc: "Personalized productivity assistant with quick actions and shortcuts",
    price: "17.99",
    icon: "🤖",
    status: "coming-soon"
  }
];

let currentApp = null;
let config = null;

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    config = await res.json();
  } catch (error) {
    console.error("Failed to load config:", error);
    config = { clientId: "", currency: "USD", productPrice: "9.99" };
  }
}

function renderApps() {
  const grid = document.getElementById("appsGrid");
  if (!grid) return;
  const renderCard = (app) => {
    const isComingSoon = app.status === "coming-soon";
    const isAvailable = app.status === "available";
    const clickHandler = isComingSoon ? "" : `onclick="openModal(${app.id})"`;
    const cardClass = isComingSoon ? "app-card coming-soon" : "app-card";
    const badge = isComingSoon ? '<div class="app-badge">Coming Soon</div>' : "";
    const priceMarkup = isAvailable
      ? `
        <div class="app-launch-label">Launch Special</div>
        <div class="app-price">
          <span class="price-original">$35</span>
          <span class="price-current" id="budgetxtCardPrice">$${app.price}</span>
        </div>
      `
      : `<div class="app-price">$${app.price}</div>`;
    return `
      <div class="${cardClass}" ${clickHandler} role="listitem">
        <div style="font-size: 64px; margin-bottom: 16px;">${app.icon}</div>
        ${badge}
        <h3>${app.name}</h3>
        <p>${app.desc}</p>
        ${priceMarkup}
      </div>
    `;
  };

  const cards = APPS.map(renderCard).join("");
  grid.innerHTML = `${cards}${cards}${cards}`;
  initCarousel();
  updateLaunchPricing();
}

async function updateLaunchPricing() {
  try {
    const res = await fetch("/api/pricing");
    if (!res.ok) return;
    const pricing = await res.json();
    const featuredPrice = document.getElementById("featuredPrice");
    if (featuredPrice) {
      featuredPrice.textContent = `$${pricing.currentPrice}`;
    }
    const cardPrice = document.getElementById("budgetxtCardPrice");
    if (cardPrice) {
      cardPrice.textContent = `$${pricing.currentPrice}`;
    }
  } catch (error) {
    console.error("Failed to update launch pricing:", error);
  }
}

function scrollToApps() {
  document.getElementById("apps").scrollIntoView({ behavior: "smooth" });
}

function scrollApps(direction) {
  const track = document.getElementById("appsGrid");
  if (!track) return;
  const card = track.querySelector(".app-card");
  const cardWidth = card ? card.getBoundingClientRect().width : 300;
  const gap = 24;
  track.scrollBy({ left: direction * (cardWidth + gap), behavior: "smooth" });
}

function initCarousel() {
  const track = document.getElementById("appsGrid");
  if (!track) return;

  const cards = track.querySelectorAll(".app-card");
  const totalCards = cards.length;
  if (totalCards === 0) return;

  const third = totalCards / 3;
  let isDragging = false;
  let startX = 0;
  let scrollStart = 0;
  let autoScrollId = null;
  let lastTime = 0;

  const card = track.querySelector(".app-card");
  const cardWidth = card ? card.getBoundingClientRect().width + 24 : 300;
  const loopWidth = cardWidth * third;

  track.scrollLeft = loopWidth;

  function normalizeScroll() {
    if (track.scrollLeft >= loopWidth * 2) {
      track.scrollLeft -= loopWidth;
    } else if (track.scrollLeft <= 0) {
      track.scrollLeft += loopWidth;
    }
  }

  track.addEventListener("scroll", normalizeScroll);

  function startAutoScroll() {
    if (autoScrollId) cancelAnimationFrame(autoScrollId);
    lastTime = performance.now();

    const step = (time) => {
      const delta = time - lastTime;
      lastTime = time;

      if (!isDragging) {
        const speed = 30; // px per second
        track.scrollLeft += (speed * delta) / 1000;
        normalizeScroll();
      }

      autoScrollId = requestAnimationFrame(step);
    };

    autoScrollId = requestAnimationFrame(step);
  }

  function stopAutoScroll() {
    if (autoScrollId) cancelAnimationFrame(autoScrollId);
    autoScrollId = null;
  }

  track.addEventListener("mousedown", (event) => {
    isDragging = true;
    track.classList.add("dragging");
    startX = event.pageX;
    scrollStart = track.scrollLeft;
    stopAutoScroll();
  });

  window.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    track.classList.remove("dragging");
    startAutoScroll();
  });

  window.addEventListener("mousemove", (event) => {
    if (!isDragging) return;
    const delta = event.pageX - startX;
    track.scrollLeft = scrollStart - delta;
  });

  track.addEventListener("mouseleave", () => {
    if (!isDragging) return;
    isDragging = false;
    track.classList.remove("dragging");
    startAutoScroll();
  });

  setTimeout(startAutoScroll, 100);
}

function openModal(appId) {
  currentApp = APPS.find((a) => a.id === appId);
  if (!currentApp) return;

  document.getElementById("modalTitle").textContent = currentApp.name;
  document.getElementById("modalDesc").textContent = currentApp.desc;
  document.getElementById("modalVisual").textContent = currentApp.icon;
  document.getElementById("modalSuccess").classList.remove("active");
  document.getElementById("modalEmail").value = "";
  document.getElementById("modalNote").textContent = "";
  document.getElementById("buyNowBtn").disabled = false;

  // Fetch and display current pricing tier
  fetchAndDisplayPrice();

  const modal = document.getElementById("appModal");
  modal.classList.add("active");
}

async function fetchAndDisplayPrice() {
  try {
    const res = await fetch("/api/pricing");
    const pricing = await res.json();
    const priceDisplay = document.getElementById("modalPrice");
    priceDisplay.textContent = `$${pricing.currentPrice}`;
    
    // Add tier info if available
    const tierInfo = pricing.currentTier ? ` (${pricing.currentTier})` : "";
    const salesInfo = pricing.salesCount ? ` - ${pricing.salesCount} sold` : "";
    if (tierInfo || salesInfo) {
      const priceNote = document.getElementById("modalPriceNote");
      if (!priceNote) {
        const note = document.createElement("div");
        note.id = "modalPriceNote";
        note.style.fontSize = "12px";
        note.style.color = "#666";
        note.style.marginTop = "4px";
        priceDisplay.parentElement.appendChild(note);
        note.textContent = tierInfo + salesInfo;
      } else {
        priceNote.textContent = tierInfo + salesInfo;
      }
    }
  } catch (err) {
    console.error("Failed to fetch pricing:", err);
    document.getElementById("modalPrice").textContent = `$${currentApp.price}`;
  }
}

function closeModal() {
  document.getElementById("appModal").classList.remove("active");
}

async function initiatePayPalCheckout() {
  const email = document.getElementById("modalEmail").value;
  if (!email) {
    document.getElementById("modalNote").textContent =
      "Please enter your email address.";
    return;
  }

  const buyBtn = document.getElementById("buyNowBtn");
  buyBtn.disabled = true;
  document.getElementById("modalNote").textContent = "Redirecting to PayPal...";

  try {
    // Create order on server
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        desiredEmail: email,
        productName: currentApp.name
      })
    });

    const data = await res.json();
    console.log("Order response:", data);
    
    if (data.error) {
      document.getElementById("modalNote").textContent = "Error creating order. Please try again.";
      buyBtn.disabled = false;
      return;
    }

    if (!data.approvalUrl) {
      console.error("No approval URL returned:", data);
      document.getElementById("modalNote").textContent = "Error: Could not get PayPal approval URL.";
      buyBtn.disabled = false;
      return;
    }

    console.log("Redirecting to:", data.approvalUrl);
    // Redirect to PayPal approval URL
    window.location.href = data.approvalUrl;
  } catch (error) {
    console.error("Checkout error:", error);
    document.getElementById("modalNote").textContent = "Error initiating checkout. Please try again.";
    buyBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadConfig();

  const appsGrid = document.getElementById("appsGrid");
  if (appsGrid) {
    renderApps();
  }

  createPetals();
  initCursorTrail();

  // Handle PayPal return (only on pages that have the modal)
  const modal = document.getElementById("appModal");
  if (modal) {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("success") === "true") {
      const key = urlParams.get("key");
      if (key) {
        // Show modal with success
        modal.classList.add("active");
        document.getElementById("modalSuccess").classList.add("active");
        document.getElementById("modalKey").textContent = key;
        document.getElementById("downloadLink").href = "/downloads/BudgetXT-Setup-1.5.3.exe";

        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }
});

function createPetals() {
  const petalsContainer = document.getElementById("petals");
  const petalCount = 15;
  
  for (let i = 0; i < petalCount; i++) {
    const petal = document.createElement("div");
    petal.classList.add("petal");
    petal.textContent = "🌸";
    petal.style.left = Math.random() * 100 + "%";
    petal.style.animationDuration = (Math.random() * 10 + 10) + "s";
    petal.style.animationDelay = Math.random() * 5 + "s";
    petalsContainer.appendChild(petal);
  }
}

function initCursorTrail() {
  const trailContainer = document.createElement("div");
  trailContainer.className = "cursor-trail";
  document.body.appendChild(trailContainer);

  const dots = Array.from({ length: 12 }, () => {
    const dot = document.createElement("div");
    dot.className = "cursor-dot";
    trailContainer.appendChild(dot);
    return { el: dot, x: 0, y: 0 };
  });

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let hue = 0;

  window.addEventListener("mousemove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });

  function animate() {
    let x = mouseX;
    let y = mouseY;
    hue = (hue + 0.3) % 360;

    dots.forEach((dot, index) => {
      dot.x += (x - dot.x) * 0.2;
      dot.y += (y - dot.y) * 0.2;
      dot.el.style.left = `${dot.x}px`;
      dot.el.style.top = `${dot.y}px`;
      dot.el.style.opacity = `${1 - index / dots.length}`;
      dot.el.style.filter = `hue-rotate(${hue}deg)`;
      x = dot.x;
      y = dot.y;
    });

    requestAnimationFrame(animate);
  }

  animate();
}
