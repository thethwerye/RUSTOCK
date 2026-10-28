(() => {
  "use strict";

  const config = window.RUSTOCK_CONFIG || {};
  const productsEl = document.getElementById("products");
  const searchEl = document.getElementById("search");
  const sortEl = document.getElementById("sort");
  const countEl = document.getElementById("results-count");
  const emptyEl = document.getElementById("empty-state");
  const statusEl = document.getElementById("status-message");
  const clearEl = document.getElementById("clear-filters");
  const dialog = document.getElementById("product-dialog");
  const detailsEl = document.getElementById("product-details");
  const paginationEl = document.getElementById("catalog-pagination");
  const pageSize = 24; // Items loaded incrementally, not all at once.

  let supabase = null;
  let pageProducts = [];
  let activeFilter = "all";
  let currentPage = 1;
  let totalProducts = 0;
  let requestSequence = 0;
  let searchTimer = null;


  // Try the configured Worker first, then the direct Supabase endpoint. This
  // allows networks where one route is filtered to use the other route.
  function createResilientFetch() {
    const primary = new URL(config.SUPABASE_URL).origin;
    const backup = "https://spocaiwbpxwwfymmhdon.supabase.co";
    return async (input, init) => {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (![new URL(primary).host, new URL(backup).host].includes(url.host)) return fetch(original);
      const endpoints = [primary, backup].filter((v, i, a) => a.indexOf(v) === i);
      let lastError;
      for (const endpoint of endpoints) {
        const destination = new URL(original.url);
        destination.host = new URL(endpoint).host;
        try {
          const headers = new Headers(original.headers);
          headers.set("apikey", config.SUPABASE_ANON_KEY);
          // Request.clone preserves multipart, Blob and binary Storage uploads on iOS.
          const request = new Request(original.clone(), { headers });
          const response = await fetch(new Request(destination.href, request));
          if (response.status < 500 && response.status !== 429) return response;
          lastError = new Error(`Сервер вернул HTTP ${response.status}`);
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error("Нет соединения с сервером");
    };
  }

  const configured = () =>
    Boolean(
      config.SUPABASE_URL &&
      config.SUPABASE_ANON_KEY &&
      !String(config.SUPABASE_URL).includes("ВСТАВЬТЕ") &&
      !String(config.SUPABASE_ANON_KEY).includes("ВСТАВЬТЕ")
    );

  const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  const formatPrice = value => {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(amount) + " ₽"
      : "Цена по запросу";
  };

  const imageOrPlaceholder = (url, alt = "") => url
    ? `<img class="product-image" src="${escapeHTML(url)}" alt="${escapeHTML(alt)}" loading="lazy" decoding="async">`
    : `<div class="image-placeholder">RUSTOCK</div>`;

    function getImageUrl(url) {
    if (typeof url !== "string" || !url.trim()) return "";
    try {
      const parsed = new URL(url.trim(), window.location.href);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
      // Route both legacy direct Supabase URLs and new public Storage URLs through
      // the same Worker so mobile networks use one consistent endpoint.
      
      return parsed.href;
    } catch {
      return "";
    }
  }

  function attachImageRecovery(container) {
    container.querySelectorAll("img").forEach(image => {
      image.addEventListener("error", () => {
        const attempts = Number(image.dataset.retryCount || 0);
        if (attempts === 0 && image.src.includes("rustock-api.hujsosite504.workers.dev")) {
          image.dataset.retryCount = "1";
          const direct = image.src.replace("rustock-api.hujsosite504.workers.dev", "spocaiwbpxwwfymmhdon.supabase.co");
          image.src = direct;
          return;
        }
        if (attempts < 4 && image.src) {
          image.dataset.retryCount = String(attempts + 1);
          const original = image.src.split("&rustock_retry=")[0].split("?rustock_retry=")[0];
          window.setTimeout(() => {
            if (!image.isConnected) return;
            image.src = original + (original.includes("?") ? "&" : "?") + "rustock_retry=" + Date.now();
          }, 350 * (attempts + 1));
          return;
        }
        const placeholder = document.createElement("div");
        placeholder.className = "image-placeholder";
        placeholder.textContent = "RUSTOCK";
        placeholder.setAttribute("role", "img");
        placeholder.setAttribute("aria-label", image.alt || "Изображение товара недоступно");
        image.replaceWith(placeholder);
      });
    });
  }

  function safeSearchTerm(value) {
    // Remove PostgREST filter syntax and wildcard characters from user input.
    return String(value || "")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function updateClearButton() {
    clearEl.hidden = !(searchEl.value.trim() || activeFilter !== "all" || sortEl.value !== "newest");
  }

  function renderPagination() {
    if (!paginationEl) return;
    const hasMore = pageProducts.length >= currentPage * pageSize;
    paginationEl.hidden = !hasMore;
    paginationEl.innerHTML = hasMore ? '<button class="pagination-button" type="button" id="load-more-products">Показать ещё</button>' : '';
    paginationEl.querySelector("button")?.addEventListener("click", () => {
      currentPage++;
      loadCatalog();
    });
  }

  function renderProducts() {
    productsEl.innerHTML = pageProducts.map(product => {
      const images = Array.isArray(product.images) ? product.images : [];
      const firstImage = getImageUrl(images[0] || "");
      return `
        <article class="product-card" tabindex="0" role="button" data-id="${escapeHTML(product.id)}" aria-label="Открыть ${escapeHTML(product.name)}">
          <div class="product-image-wrap">
            ${imageOrPlaceholder(firstImage, product.name)}
            <span class="stock-badge">${product.available ? "В наличии" : "Под заказ"}</span>
          </div>
          <div class="product-info">
            <h2 class="product-name">${escapeHTML(product.name)}</h2>
            <div class="product-bottom">
              <span class="product-price">${formatPrice(product.price)}</span>
            </div>
          </div>
        </article>`;
    }).join("");

    countEl.textContent = totalProducts === 0
      ? "Товаров не найдено"
      : `Показано ${pageProducts.length} из ${totalProducts} товаров`;

    emptyEl.hidden = totalProducts !== 0;
    updateClearButton();
    renderPagination();
    attachImageRecovery(productsEl);

    productsEl.querySelectorAll(".product-card").forEach(card => {
      const open = () => {
        const product = pageProducts.find(item => String(item.id) === card.dataset.id);
        if (product) openProduct(product);
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }

  function openImageLightbox(images, startIndex, productName) {
    if (!Array.isArray(images) || !images.length) return;

    let lightbox = document.getElementById("image-lightbox");
    if (!lightbox) {
      lightbox = document.createElement("dialog");
      lightbox.id = "image-lightbox";
      lightbox.className = "image-lightbox";
      lightbox.setAttribute("aria-label", "Просмотр фотографий");
      lightbox.innerHTML = `
        <button class="image-lightbox-close" type="button" aria-label="Закрыть фотографию">×</button>
        <button class="image-lightbox-prev" type="button" aria-label="Предыдущее фото">‹</button>
        <img class="image-lightbox-image" alt="" draggable="false">
        <button class="image-lightbox-next" type="button" aria-label="Следующее фото">›</button>
        <div class="image-lightbox-counter"></div>`;
      document.body.appendChild(lightbox);

      const previous = () => {
        lightbox._index = (lightbox._index - 1 + lightbox._images.length) % lightbox._images.length;
        updateLightbox();
      };
      const next = () => {
        lightbox._index = (lightbox._index + 1) % lightbox._images.length;
        updateLightbox();
      };
      lightbox.querySelector(".image-lightbox-close").addEventListener("click", () => lightbox.close());
      lightbox.querySelector(".image-lightbox-prev").addEventListener("click", previous);
      lightbox.querySelector(".image-lightbox-next").addEventListener("click", next);
      lightbox.addEventListener("click", event => { if (event.target === lightbox) lightbox.close(); });
      lightbox.addEventListener("keydown", event => {
        if (event.key === "ArrowLeft") { event.preventDefault(); previous(); }
        if (event.key === "ArrowRight") { event.preventDefault(); next(); }
        if (event.key === "Escape" && !lightbox.open) lightbox.removeAttribute("open");
      });

      // Reliable touch swipe for iOS Safari and Android browsers.
      let touchStartX = 0;
      let touchStartY = 0;
      lightbox.addEventListener("touchstart", event => {
        if (!event.changedTouches.length) return;
        touchStartX = event.changedTouches[0].clientX;
        touchStartY = event.changedTouches[0].clientY;
      }, { passive: true });
      lightbox.addEventListener("touchend", event => {
        if (!event.changedTouches.length || lightbox._images.length < 2) return;
        const dx = event.changedTouches[0].clientX - touchStartX;
        const dy = event.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          if (dx < 0) next(); else previous();
        }
      }, { passive: true });
    }

    lightbox._images = images;
    lightbox._index = Math.max(0, Math.min(Number(startIndex) || 0, images.length - 1));
    lightbox._productName = productName || "Товар";

    function updateLightbox() {
      const image = lightbox.querySelector(".image-lightbox-image");
      const counter = lightbox.querySelector(".image-lightbox-counter");
      image.dataset.retryCount = "0";
      image.dataset.retryCount = "0";
      image.onerror = () => {
        if (image.dataset.retryCount === "0" && image.src.includes("rustock-api.hujsosite504.workers.dev")) {
          image.dataset.retryCount = "1";
          image.src = image.src.replace("rustock-api.hujsosite504.workers.dev", "spocaiwbpxwwfymmhdon.supabase.co");
        }
      };
      image.src = getImageUrl(lightbox._images[lightbox._index]);
      image.alt = `${lightbox._productName} — фото ${lightbox._index + 1}`;
      counter.textContent = `${lightbox._index + 1} / ${lightbox._images.length}`;
      const multiple = lightbox._images.length > 1;
      lightbox.querySelector(".image-lightbox-prev").hidden = !multiple;
      lightbox.querySelector(".image-lightbox-next").hidden = !multiple;
      counter.hidden = !multiple;
    }

    updateLightbox();
    if (typeof lightbox.showModal === "function") {
      if (!lightbox.open) lightbox.showModal();
    } else {
      lightbox.setAttribute("open", "");
      lightbox.style.display = "flex";
    }
  }

  function openProduct(product) {
    const images = Array.isArray(product.images)
      ? product.images.filter(Boolean).map(getImageUrl)
      : [];
    const characteristics = product.characteristics && typeof product.characteristics === "object"
      ? product.characteristics : {};
    let currentIndex = 0;

    detailsEl.innerHTML = `
      <div class="product-details">
        <div class="detail-gallery">
          <div class="detail-image-stage">
            ${images.length
              ? `<img id="detail-main-image" class="detail-main-image" src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}" decoding="async">`
              : `<div class="detail-main-image image-placeholder">RUSTOCK</div>`}
            ${images.length > 1 ? `
              <button class="detail-gallery-arrow detail-gallery-prev" type="button" aria-label="Предыдущее фото">‹</button>
              <button class="detail-gallery-arrow detail-gallery-next" type="button" aria-label="Следующее фото">›</button>
              <span class="detail-gallery-counter">1 / ${images.length}</span>
            ` : ""}
          </div>
          ${images.length > 1 ? `<div class="detail-thumbnails">
            ${images.map((url, index) => `
              <button class="detail-thumb ${index === 0 ? "active" : ""}" data-index="${index}" type="button" aria-label="Фото ${index + 1}" aria-pressed="${index === 0}">
                <img src="${escapeHTML(url)}" alt="" loading="lazy" decoding="async">
              </button>`).join("")}
          </div>` : ""}
        </div>
        <div class="detail-copy">
          <h2>${escapeHTML(product.name)}</h2>
          <p class="detail-price">${formatPrice(product.price)}</p>
          <span class="detail-status">${product.available ? "В наличии" : "Под заказ"}</span>
          ${product.description ? `<p class="detail-description">${escapeHTML(product.description)}</p>` : ""}
          ${Object.keys(characteristics).length ? `
            <h3 class="detail-section-title">Характеристики:</h3>
            <dl class="characteristics">
              ${Object.entries(characteristics)
                .filter(([key, value]) => String(key).trim() && String(value).trim())
                .map(([key, value]) => `<div class="characteristic-row"><dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}</dd></div>`)
                .join("")}
            </dl>` : ""}
        </div>
      </div>`;

    const gallery = detailsEl.querySelector(".detail-gallery");
    const mainImage = detailsEl.querySelector("#detail-main-image");
    const counter = detailsEl.querySelector(".detail-gallery-counter");
    const thumbnails = detailsEl.querySelectorAll(".detail-thumb");

    function showImage(index) {
      if (!images.length || !mainImage) return;
      currentIndex = (index + images.length) % images.length;
      mainImage.src = images[currentIndex];
      mainImage.alt = `${product.name} — фото ${currentIndex + 1}`;
      if (counter) counter.textContent = `${currentIndex + 1} / ${images.length}`;
      thumbnails.forEach((button, i) => {
        const active = i === currentIndex;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    detailsEl.querySelector(".detail-gallery-prev")?.addEventListener("click", () => showImage(currentIndex - 1));
    detailsEl.querySelector(".detail-gallery-next")?.addEventListener("click", () => showImage(currentIndex + 1));
    thumbnails.forEach(button => button.addEventListener("click", () => showImage(Number(button.dataset.index))));
    if (mainImage && images.length) {
      mainImage.setAttribute("role", "button");
      mainImage.setAttribute("tabindex", "0");
      mainImage.setAttribute("aria-label", "Открыть фотографию крупнее");
      mainImage.addEventListener("click", () =>
        openImageLightbox(images, currentIndex, product.name)
      );
      mainImage.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openImageLightbox(images, currentIndex, product.name);
        }
      });
    }

    if (gallery && images.length > 1) {
      let touchStartX = 0;
      let touchStartY = 0;
      gallery.addEventListener("touchstart", event => {
        touchStartX = event.changedTouches[0].clientX;
        touchStartY = event.changedTouches[0].clientY;
      }, { passive: true });
      gallery.addEventListener("touchend", event => {
        const deltaX = event.changedTouches[0].clientX - touchStartX;
        const deltaY = event.changedTouches[0].clientY - touchStartY;
        if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY)) {
          showImage(currentIndex + (deltaX < 0 ? 1 : -1));
        }
      }, { passive: true });
    }

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  async function loadCatalog() {
    if (!configured()) {
      countEl.textContent = "Supabase ещё не настроен";
      statusEl.textContent = "Откройте config.js и укажите Project URL и публичный anon/publishable key из Supabase.";
      productsEl.removeAttribute("aria-busy");
      return;
    }

    const sequence = ++requestSequence;
    statusEl.textContent = "";
    countEl.textContent = "Загружаем каталог…";
    productsEl.setAttribute("aria-busy", "true");

    try {
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      const columns = "id,name,price,short_description,description,characteristics,images,available,created_at";
      let query = supabase.from("products").select(columns);

      if (activeFilter === "available") query = query.eq("available", true);
      if (activeFilter === "order") query = query.eq("available", false);

      const term = safeSearchTerm(searchEl.value);
      if (term) {
        const pattern = `%${term}%`;
        query = query.or(
          `name.ilike.${pattern},short_description.ilike.${pattern},description.ilike.${pattern}`
        );
      }

      switch (sortEl.value) {
        case "price-asc":
          query = query.order("price", { ascending: true }).order("created_at", { ascending: false });
          break;
        case "price-desc":
          query = query.order("price", { ascending: false }).order("created_at", { ascending: false });
          break;
        case "name":
          query = query.order("name", { ascending: true }).order("id", { ascending: true });
          break;
        default:
          query = query.order("created_at", { ascending: false }).order("id", { ascending: true });
      }

      let response;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        let timeoutId;
        try {
          response = await Promise.race([
            query.range(from, to),
            new Promise((_, reject) => {
              timeoutId = window.setTimeout(() => reject(new Error("Превышено время ожидания Supabase")), 10000);
            })
          ]);
          window.clearTimeout(timeoutId);
          if (!response.error) break;
          lastError = response.error;
          if (attempt === 2) throw lastError;
        } catch (error) {
          window.clearTimeout(timeoutId);
          lastError = error;
          if (attempt === 2) throw lastError;
        }
        await new Promise(resolve => window.setTimeout(resolve, 300 * (attempt + 1)));
      }
      const { data, error, count } = response || { data: [], error: lastError, count: 0 };
      if (error) throw error;
      
      if (sequence !== requestSequence) return;
      if (error) throw error;

      totalProducts = 0;
      pageProducts = currentPage === 1 ? (data || []) : [...pageProducts, ...(data || [])];
      renderProducts();
    } catch (error) {
      if (sequence !== requestSequence) return;
      // Keep the last successfully rendered catalog visible during transient network failures.
      if (!pageProducts.length) {
        productsEl.innerHTML = "";
        paginationEl.hidden = true;
      }
      countEl.textContent = pageProducts.length ? `Не удалось обновить каталог (${pageProducts.length} товаров показано)` : "Не удалось загрузить каталог";
      statusEl.textContent = `Ошибка Supabase: ${error.message || String(error)}. Проверьте подключение и политики доступа.`;
    } finally {
      if (sequence === requestSequence) productsEl.removeAttribute("aria-busy");
    }
  }

  document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    currentPage = 1;
    document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === button));
    loadCatalog();
  }));

  searchEl.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      currentPage = 1;
      loadCatalog();
    }, 280);
  });

  sortEl.addEventListener("change", () => {
    currentPage = 1;
    loadCatalog();
  });

  clearEl.addEventListener("click", () => {
    searchEl.value = "";
    sortEl.value = "newest";
    activeFilter = "all";
    currentPage = 1;
    document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item.dataset.filter === "all"));
    loadCatalog();
  });

  document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    detailsEl.innerHTML = "";
    if (document.activeElement && document.activeElement.classList?.contains("product-card")) {
      document.activeElement.blur();
    }
    requestAnimationFrame(() => {
      const focused = document.querySelector(".product-card:focus");
      if (focused) focused.blur();
    });
  });

  if (configured() && window.supabase?.createClient) {
    supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createResilientFetch() }
    });
    loadCatalog();
  } else {
    countEl.textContent = "Supabase ещё не настроен";
    statusEl.textContent = "Откройте config.js и укажите Project URL и публичный anon/publishable key из Supabase.";
    productsEl.removeAttribute("aria-busy");
  }
})();
