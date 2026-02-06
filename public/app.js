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
    desc: "BudgetXT is a simple, no-drama budgeting app for Windows. Add income, log expenses, and it shows you what's left for the month, clean and easy. No subscriptions, no accounts, no cloud stuff. Your data stays on your PC. Great for freelancers and daily users who just want a clear picture of tracking their budget and finances. (For Windows PC) - Early Version",
    price: "14.99",
    icon: "💰",
    status: "available",
    fileSize: "45 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 2,
    name: "AgendaXT",
    desc: "coming soon to Windows OS",
    price: "19.99",
    icon: "🗓️",
    status: "coming-soon",
    fileSize: "38 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 3,
    name: "InventoryXT",
    desc: "coming soon to Windows OS",
    price: "29.99",
    icon: "📦",
    status: "coming-soon",
    fileSize: "52 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 4,
    name: "FileSorterXT",
    desc: "coming soon to Windows OS",
    price: "14.99",
    icon: "🗂️",
    status: "coming-soon",
    fileSize: "35 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 5,
    name: "BookedXT",
    desc: "coming soon to Windows OS",
    price: "24.99",
    icon: "📅",
    status: "coming-soon",
    fileSize: "48 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 6,
    name: "PanicXT",
    desc: "coming soon to iOS & iPadOS",
    price: "11.99",
    icon: "🚨",
    status: "coming-soon",
    fileSize: "32 MB",
    requirements: "Windows 10/11 (64-bit)"
  },
  {
    id: 7,
    name: "RoccoXT",
    desc: "coming soon to Windows OS",
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
  const isMobile = window.innerWidth <= 768;
  grid.innerHTML = isMobile ? cards : `${cards}${cards}${cards}`;
  if (!isMobile) {
    initCarousel();
  }
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
  // Disable carousel on mobile/tablet devices
  if (window.innerWidth <= 768) return;
  
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

  // Only create petals and cursor trail on desktop
  if (window.innerWidth > 768) {
    createPetals();
    initCursorTrail();
  }

  // Mobile hamburger menu
  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('nav');
  
  if (hamburger && nav) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      nav.classList.toggle('active');
    });

    // Close menu when clicking a link
    const navLinks = nav.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        nav.classList.remove('active');
      });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!hamburger.contains(e.target) && !nav.contains(e.target)) {
        hamburger.classList.remove('active');
        nav.classList.remove('active');
      }
    });
  }

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
  let hue = 0;
  let trailLength = 12;
  let colorMode = 0; // 0: black dots, 1: rainbow dots (each different), 2: solid cycling dots

  // Default trail: 12 following dots
  const dots = Array.from({ length: trailLength }, () => {
    const dot = document.createElement("div");
    dot.className = "cursor-dot";
    trailContainer.appendChild(dot);
    return { el: dot, x: 0, y: 0 };
  });

  // Add click handler to tech circle to toggle trail length and color mode
  const techCircle = document.querySelector('.tech-circle');
  if (techCircle) {
    techCircle.style.cursor = 'pointer';
    techCircle.addEventListener('click', () => {
      // Toggle between 12 and 24 dots
      trailLength = trailLength === 12 ? 24 : 12;
      
      // Cycle color mode
      colorMode = (colorMode + 1) % 3;
      
      // Clear existing dots
      dots.length = 0;
      trailContainer.querySelectorAll('.cursor-dot').forEach(dot => dot.remove());
      
      // Add new dots
      Array.from({ length: trailLength }, () => {
        const dot = document.createElement("div");
        dot.className = "cursor-dot";
        trailContainer.appendChild(dot);
        return { el: dot, x: 0, y: 0 };
      }).forEach(dot => dots.push(dot));
      
      // Visual feedback
      techCircle.style.transform = 'scale(0.95)';
      setTimeout(() => {
        techCircle.style.transform = '';
      }, 150);
    });
  }

  window.addEventListener("mousemove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });

  function interpolateColor(color1, color2, t) {
    // t is 0-1, returns interpolated RGB
    return {
      r: Math.round(color1.r + (color2.r - color1.r) * t),
      g: Math.round(color1.g + (color2.g - color1.g) * t),
      b: Math.round(color1.b + (color2.b - color1.b) * t)
    };
  }

  function animate() {
    let x = mouseX;
    let y = mouseY;
    hue = (hue + 0.2) % 360;

    const rainbowColors = [
      { r: 255, g: 0, b: 0 },       // Red
      { r: 255, g: 127, b: 0 },     // Orange
      { r: 255, g: 255, b: 0 },     // Yellow
      { r: 0, g: 255, b: 0 },       // Green
      { r: 0, g: 255, b: 255 },     // Cyan
      { r: 0, g: 0, b: 255 },       // Blue
      { r: 127, g: 0, b: 255 },     // Purple
    ];

    dots.forEach((dot, index) => {
      dot.x += (x - dot.x) * 0.2;
      dot.y += (y - dot.y) * 0.2;
      dot.el.style.left = `${dot.x}px`;
      dot.el.style.top = `${dot.y}px`;
      dot.el.style.opacity = `${1 - index / dots.length}`;
      
      if (colorMode === 0) {
        // Black dots that glow
        dot.el.style.filter = '';
        dot.el.style.background = 'radial-gradient(circle, rgba(0, 0, 0, 0.9), rgba(0, 0, 0, 0.3))';
        dot.el.style.boxShadow = '0 0 12px rgba(0, 0, 0, 0.8)';
      } else if (colorMode === 1) {
        // Rainbow dots - each dot shifts through colors smoothly
        dot.el.style.filter = '';
        const shiftedHue = (hue + index * 51.4) % 360;
        const colorPos = (shiftedHue / 360) * rainbowColors.length;
        const colorIndex = Math.floor(colorPos);
        const nextColorIndex = (colorIndex + 1) % rainbowColors.length;
        const t = colorPos - colorIndex;
        const color = interpolateColor(rainbowColors[colorIndex], rainbowColors[nextColorIndex], t);
        dot.el.style.background = `radial-gradient(circle, rgba(${color.r}, ${color.g}, ${color.b}, 0.9), rgba(${color.r}, ${color.g}, ${color.b}, 0.2))`;
        dot.el.style.boxShadow = `0 0 12px rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`;
      } else if (colorMode === 2) {
        // Solid cycling dots - all same color changing together smoothly
        dot.el.style.filter = '';
        const colorPos = (hue / 360) * rainbowColors.length;
        const colorIndex = Math.floor(colorPos);
        const nextColorIndex = (colorIndex + 1) % rainbowColors.length;
        const t = colorPos - colorIndex;
        const color = interpolateColor(rainbowColors[colorIndex], rainbowColors[nextColorIndex], t);
        dot.el.style.background = `radial-gradient(circle, rgba(${color.r}, ${color.g}, ${color.b}, 0.9), rgba(${color.r}, ${color.g}, ${color.b}, 0.2))`;
        dot.el.style.boxShadow = `0 0 12px rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`;
      }
      
      x = dot.x;
      y = dot.y;
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
      
      // Clear all existing reviews (HTML grid is now empty by default)
      grid.innerHTML = '';
      
      // Add real reviews to the grid (limit to 6 total)
      const limit = Math.min(data.reviews.length, 6);
      for (let i = 0; i < limit; i++) {
        const review = data.reviews[i];
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
      }
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
