// Load PayPal SDK dynamically
function loadPayPalSDK(clientId) {
  if (window.paypal) return; // Already loaded
  
  const script = document.createElement('script');
  script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture&enable-funding=venmo,paylater`;
  script.async = true;
  document.head.appendChild(script);
}

const APPS = [
  {
    id: 1,
    name: "BudgetXT",
    desc: "Take control of your finances without the overwhelm. Built by someone who gets it—budgeting shouldn't be complicated. Track spending, set goals, and finally see where your money goes. Perfect for real people, not accountants. (Windows PC)",
    price: "14.99",
    icon: "💰",
    status: "available",
    fileSize: "45 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 2,
    name: "AgendaXT",
    desc: "Smart daily planning with focus blocks, reminders, and clean schedules (Windows PC)",
    price: "19.99",
    icon: "🗓️",
    status: "coming-soon",
    fileSize: "38 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 3,
    name: "InventoryXT",
    desc: "Simple inventory tracking with low-stock alerts and quick exports (Windows PC)",
    price: "29.99",
    icon: "📦",
    status: "coming-soon",
    fileSize: "52 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 4,
    name: "FileSorterXT",
    desc: "Organize files automatically with rules, tags, and smart cleanup (Windows PC)",
    price: "14.99",
    icon: "🗂️",
    status: "coming-soon",
    fileSize: "35 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 5,
    name: "BookedXT",
    desc: "Client booking, calendar sync, and payments in one place (Windows PC)",
    price: "24.99",
    icon: "📅",
    status: "coming-soon",
    fileSize: "48 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 6,
    name: "PanicXT",
    desc: "Instant emergency checklists and one-tap safety actions (Windows PC)",
    price: "11.99",
    icon: "🚨",
    status: "coming-soon",
    fileSize: "32 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 7,
    name: "RoccoXT",
    desc: "Personalized productivity assistant with quick actions and shortcuts (Windows PC)",
    price: "17.99",
    icon: "🤖",
    status: "coming-soon",
    fileSize: "55 MB",
    requirements: "Windows 10/11 (64-bit)"
  }
];

let currentApp = null;
let config = null;

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    config = await res.json();
    if (config.clientId) {
      loadPayPalSDK(config.clientId);
    }
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
          <span class="price-current budgetxt-card-price">$${app.price}</span>
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
    const cardPrices = document.querySelectorAll(".budgetxt-card-price");
    if (cardPrices.length) {
      cardPrices.forEach((priceEl) => {
        priceEl.textContent = `$${pricing.currentPrice}`;
      });
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
  document.getElementById("modalSuccess").classList.remove("active");
  document.getElementById("modalEmail").value = "";
  document.getElementById("modalNote").textContent = "";
  document.getElementById("buyNowBtn").disabled = false;

  // Display app info (file size and requirements)
  const appInfo = document.getElementById("appInfo");
  if (appInfo && currentApp.fileSize && currentApp.requirements) {
    appInfo.innerHTML = `
      <div class="info-item">
        <span class="info-label">📦 File Size:</span>
        <span class="info-value">${currentApp.fileSize}</span>
      </div>
      <div class="info-item">
        <span class="info-label">💻 Requirements:</span>
        <span class="info-value">${currentApp.requirements}</span>
      </div>
    `;
  }

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

  // Load real user reviews
  loadReviews();

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
        
        // Hide PayPal button after successful payment
        const paypalBtn = document.getElementById("buyNowBtn");
        if (paypalBtn) paypalBtn.style.display = "none";
        
        // Hide email input field
        const emailInput = document.getElementById("modalEmail");
        if (emailInput && emailInput.previousElementSibling) {
          emailInput.style.display = "none";
          emailInput.previousElementSibling.style.display = "none"; // Hide label too
        }

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

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let currentStyle = 0;
  const trailStyles = ['default', 'draw', 'particle', 'stars', 'tron'];
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE'];
  let colorIndex = 0;

  // Default trail: 12 following dots
  const dots = Array.from({ length: 12 }, () => {
    const dot = document.createElement("div");
    dot.className = "cursor-dot";
    trailContainer.appendChild(dot);
    return { el: dot, x: 0, y: 0 };
  });

  // Draw trail: persistent dots that fade out
  const drawTrails = [];

  // Particle trail: falling particles
  const particles = [];

  // Star trail: clicked stars that change color
  const starTrails = [];

  // Tron trail: single line following cursor
  const tronLine = document.createElement("div");
  tronLine.className = "cursor-dot tron-line";
  trailContainer.appendChild(tronLine);

  // Add click handler to tech circle to cycle trail styles
  const techCircle = document.querySelector('.tech-circle');
  if (techCircle) {
    techCircle.style.cursor = 'pointer';
    techCircle.addEventListener('click', () => {
      currentStyle = (currentStyle + 1) % trailStyles.length;
      trailContainer.className = `cursor-trail ${trailStyles[currentStyle]}`;
      
      // Visual feedback
      techCircle.style.transform = 'scale(0.95)';
      setTimeout(() => {
        techCircle.style.transform = '';
      }, 150);
    });
  }

  // Click handler for stars style
  document.addEventListener('click', (event) => {
    if (trailStyles[currentStyle] === 'stars') {
      const star = document.createElement('div');
      star.className = 'click-star';
      star.style.left = event.clientX + 'px';
      star.style.top = event.clientY + 'px';
      star.style.color = colors[colorIndex % colors.length];
      colorIndex++;
      star.textContent = '⭐';
      trailContainer.appendChild(star);
      starTrails.push({ el: star, time: 0 });
      
      setTimeout(() => {
        star.remove();
        starTrails.shift();
      }, 3000);
    }
  });

  window.addEventListener("mousemove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;

    // Create particle on mouse move for particle style
    if (trailStyles[currentStyle] === 'particle') {
      const particle = document.createElement('div');
      particle.className = 'falling-particle';
      particle.style.left = mouseX + 'px';
      particle.style.top = mouseY + 'px';
      particle.style.color = colors[Math.floor(Math.random() * colors.length)];
      particle.textContent = '❄️';
      trailContainer.appendChild(particle);
      particles.push({ el: particle, time: 0 });
    }

    // Create draw trail for draw style
    if (trailStyles[currentStyle] === 'draw') {
      const drawDot = document.createElement('div');
      drawDot.className = 'draw-dot';
      drawDot.style.left = mouseX + 'px';
      drawDot.style.top = mouseY + 'px';
      trailContainer.appendChild(drawDot);
      drawTrails.push({ el: drawDot, time: 0 });
    }
  });

  function animate() {
    let x = mouseX;
    let y = mouseY;

    // Default style: following dots
    if (trailStyles[currentStyle] === 'default') {
      dots.forEach((dot, index) => {
        dot.x += (x - dot.x) * 0.2;
        dot.y += (y - dot.y) * 0.2;
        dot.el.style.left = `${dot.x}px`;
        dot.el.style.top = `${dot.y}px`;
        dot.el.style.opacity = `${1 - index / dots.length}`;
        x = dot.x;
        y = dot.y;
      });
    }

    // Tron style: single line
    if (trailStyles[currentStyle] === 'tron') {
      tronLine.style.left = `${mouseX}px`;
      tronLine.style.top = `${mouseY}px`;
      tronLine.style.opacity = '1';
    }

    // Update draw trail fade
    drawTrails.forEach((item, index) => {
      item.time += 16; // ~60fps
      const progress = item.time / 90000; // 90 second duration
      item.el.style.opacity = Math.max(0, 1 - progress);
      if (progress >= 1) {
        item.el.remove();
        drawTrails.splice(index, 1);
      }
    });

    // Update falling particles
    particles.forEach((item, index) => {
      item.time += 16;
      const progress = item.time / 3000; // 3 second duration
      item.el.style.transform = `translateY(${progress * 100}px)`;
      item.el.style.opacity = Math.max(0, 1 - progress);
      if (progress >= 1) {
        item.el.remove();
        particles.splice(index, 1);
      }
    });

    requestAnimationFrame(animate);
  }

  animate();
}

async function loadReviews() {
  try {
    const response = await fetch('/api/reviews');
    const data = await response.json();
    
    if (data.reviews && data.reviews.length > 0) {
      const grid = document.getElementById('testimonialsGrid');
      if (!grid) return;
      
      // Add real reviews to the grid (keeping default ones and adding new ones)
      data.reviews.forEach(review => {
        const avatars = ['👨', '👩', '🧑', '👴', '👵'];
        const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];
        const stars = '⭐'.repeat(review.rating);
        
        const card = document.createElement('div');
        card.className = 'testimonial-card';
        card.innerHTML = `
          <div class="testimonial-stars" style="color: #ffc107; margin-bottom: 8px;">${stars}</div>
          <p class="testimonial-text">"${review.text}"</p>
          <div class="testimonial-author">
            <div class="testimonial-avatar">${randomAvatar}</div>
            <div class="testimonial-info">
              <h4>${review.name}</h4>
              <p>${new Date(review.date).toLocaleDateString()}</p>
            </div>
          </div>
        `;
        grid.appendChild(card);
      });
    }
  } catch (error) {
    console.error('Error loading reviews:', error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  renderApps();
  createPetals();
  initCursorTrail();
  loadReviews();
});
