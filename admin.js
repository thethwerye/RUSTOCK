(() => {
  const config = window.RUSTOCK_CONFIG || {};

  // Use a single endpoint. Never wait for a blocked endpoint before trying another.
  function createResilientFetch() {
    return (input, init) => fetch(input, init);
  }

  const configured = () =>
    config.SUPABASE_URL && config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_URL.includes("ВСТАВЬТЕ") &&
    !config.SUPABASE_ANON_KEY.includes("ВСТАВЬТЕ");

  const $ = id => document.getElementById(id);
  const authSection = $("auth-section");
  const dashboard = $("dashboard-section");
  const loginForm = $("login-form");
  const loginMessage = $("login-message");
  const form = $("product-form");
  const formMessage = $("form-message");
  const listMessage = $("list-message");
  const productsList = $("admin-products");
  const currentImagesEl = $("current-images");
  const paginationEl = $("admin-pagination");
  const adminPageSize = 25;
  let supabase = null;
  let products = [];
  let currentImages = [];
  let adminPage = 1;
  let totalAdminProducts = 0;
  let listRequestSequence = 0;
  let dashboardLoading = false;

  const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const money = value => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value) || 0) + " ₽";
  const normalizeImageUrl = value => {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, window.location.href);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      /* Keep original storage host; avoid unnecessary image proxy. */
      if (url.hostname === "spocaiwbpxwwfymmhdon.supabase.co" && url.pathname.startsWith("/storage/v1/object/public/")) {
        return config.SUPABASE_URL.replace(/\/$/, "") + url.pathname + url.search;
      }
      return url.href;
    } catch { return ""; }
  };
  const setMessage = (el, text, kind = "") => {
    el.textContent = text;
    el.className = "admin-message" + (kind ? " " + kind : "");
  };

  if (!configured()) {
    setMessage(loginMessage, "Сначала настройте config.js: вставьте Project URL и anon/public key из Supabase.");
    loginForm.querySelector("button[type=submit]").disabled = true;
    return;
  }
  supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, { global: { fetch: createResilientFetch() } });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = loginForm.querySelector("button[type=submit]");
    button.disabled = true;
    setMessage(loginMessage, "Выполняется вход…");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
      });
      if (error) {
        setMessage(loginMessage, "Не удалось войти: " + error.message, "error");
        return;
      }
      await showDashboard();
    } catch (error) {
      setMessage(loginMessage, "Не удалось выполнить вход. Проверьте интернет и настройки Supabase.", "error");
    } finally {
      button.disabled = false;
    }
  });

  $("logout-button").addEventListener("click", async () => {
    await supabase.auth.signOut();
    dashboard.hidden = true;
    authSection.hidden = false;
    form.reset();
    resetFormState();
    setMessage(loginMessage, "Вы вышли из панели.");
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session && dashboard.hidden && !dashboardLoading) setTimeout(() => showDashboard(), 0);
  });

  async function showDashboard() {
    if (dashboardLoading) return;
    dashboardLoading = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      authSection.hidden = true;
      dashboard.hidden = false;
      await loadProducts();
    } finally { dashboardLoading = false; }
  }

  async function loadProducts() {
    const requestId = ++listRequestSequence;
    productsList.innerHTML = `<p class="muted">Загрузка товаров…</p>`;
    const from = (adminPage - 1) * adminPageSize;
    const to = from + adminPageSize - 1;
    let data, error, count;
    try {
      ({ data, error, count } = await supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to + 1));
    } catch (err) { error = err; }

    if (requestId !== listRequestSequence) return;
    if (error) {
      productsList.innerHTML = "";
      paginationEl.hidden = true;
      setMessage(listMessage, "Не удалось загрузить товары: " + error.message + ". Убедитесь, что ваш пользователь добавлен в таблицу admins в Supabase.", "error");
      return;
    }

    const hasNextAdminPage = (data || []).length > adminPageSize;
    totalAdminProducts = (adminPage - 1) * adminPageSize + Math.min((data || []).length, adminPageSize) + (hasNextAdminPage ? 1 : 0);
    const maxPage = Math.max(1, Math.ceil(totalAdminProducts / adminPageSize));
    if (adminPage > maxPage) {
      adminPage = maxPage;
      return loadProducts();
    }

    products = (data || []).slice(0, adminPageSize);
    renderAdminProducts();
    renderAdminPagination();
    setMessage(listMessage, "");
  }

  function renderAdminPagination() {
    if (!paginationEl) return;
    const pages = Math.max(1, Math.ceil(totalAdminProducts / adminPageSize));
    if (totalAdminProducts <= adminPageSize) {
      paginationEl.hidden = true;
      paginationEl.innerHTML = "";
      return;
    }

    paginationEl.hidden = false;
    paginationEl.innerHTML = `
      <button class="pagination-button" type="button" data-admin-page="${adminPage - 1}" ${adminPage <= 1 ? "disabled" : ""}>← Назад</button>
      <span class="pagination-label">Страница ${adminPage} из ${pages}</span>
      <button class="pagination-button" type="button" data-admin-page="${adminPage + 1}" ${adminPage >= pages ? "disabled" : ""}>Далее →</button>
    `;
    paginationEl.querySelectorAll("[data-admin-page]").forEach(button => {
      button.addEventListener("click", () => {
        const nextPage = Number(button.dataset.adminPage);
        if (nextPage < 1 || nextPage > pages || nextPage === adminPage) return;
        adminPage = nextPage;
        loadProducts();
      });
    });
  }

  function renderAdminProducts() {
    if (!products.length) {
      productsList.innerHTML = `<p class="muted">Пока нет товаров. Добавьте первый через форму выше.</p>`;
      return;
    }
    productsList.innerHTML = products.map(product => {
      const image = Array.isArray(product.images) ? normalizeImageUrl(product.images[0]) : "";
      return `<article class="admin-product">
        ${image ? `<img src="${escapeHTML(image)}" alt="" loading="lazy" decoding="async">` : `<div class="image-placeholder">RUSTOCK</div>`}
<div>
  <h3>${escapeHTML(product.name)}</h3>
  <p>${money(product.price)} · ${product.available ? "В наличии" : "Под заказ"}</p>
</div>
        <div class="admin-product-actions">
          <button class="button secondary" type="button" data-edit="${escapeHTML(product.id)}">Изменить</button>
          <button class="button danger" type="button" data-delete="${escapeHTML(product.id)}">Удалить</button>
        </div>
      </article>`;
    }).join("");

    productsList.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => {
      const product = products.find(item => String(item.id) === button.dataset.edit);
      if (product) editProduct(product);
    }));
    productsList.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", () => {
      const product = products.find(item => String(item.id) === button.dataset.delete);
      if (product) deleteProduct(product);
    }));
  }

  function renderCurrentImages() {
    if (!currentImages.length) {
      currentImagesEl.innerHTML = `<span class="muted">Сохранённых фотографий нет.</span>`;
      return;
    }
    currentImagesEl.innerHTML = currentImages.map((url, index) => `
      <div class="current-image">
        <img src="${escapeHTML(normalizeImageUrl(url))}" alt="Фото ${index + 1}" loading="lazy" decoding="async">
        <button type="button" data-remove-image="${index}" aria-label="Убрать фото">×</button>
      </div>`).join("");
    currentImagesEl.querySelectorAll("[data-remove-image]").forEach(button => button.addEventListener("click", () => {
      currentImages.splice(Number(button.dataset.removeImage), 1);
      renderCurrentImages();
    }));
  }

  function editProduct(product) {
    $("product-id").value = product.id;
    $("name").value = product.name || "";
    $("price").value = product.price ?? "";
    $("description").value = product.description || "";
    $("characteristics").value = Object.entries(product.characteristics || {}).map(([key, value]) => `${key}: ${value}`).join("\n");
    $("available").checked = product.available === true;
    $("images").value = "";
    currentImages = Array.isArray(product.images) ? product.images.map(normalizeImageUrl).filter(Boolean) : [];
    renderCurrentImages();
    $("form-title").textContent = "Редактировать товар";
    $("save-button").textContent = "Сохранить изменения";
    setMessage(formMessage, "Режим редактирования: " + product.name);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetFormState() {
    $("product-id").value = "";
    $("images").value = "";
    currentImages = [];
    renderCurrentImages();
    $("form-title").textContent = "Добавить товар";
    $("save-button").textContent = "Сохранить товар";
    setMessage(formMessage, "");
  }
  $("reset-button").addEventListener("click", () => {
    form.reset();
    $("available").checked = true;
    resetFormState();
  });

  function parseCharacteristics(text) {
    const result = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const separator = line.indexOf(":");
      if (separator <= 0) throw new Error(`Строка характеристики должна иметь формат «Название: значение»: ${line}`);
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key && value) result[key] = value;
    }
    return result;
  }

  async function optimizeImage(file) {
    // Resize and convert large product photos to WebP before upload.
    // If the browser cannot decode/convert the image, keep the original file.
    if (typeof createImageBitmap !== "function" || typeof File !== "function") return file;

    try {
      const bitmap = await createImageBitmap(file);
      const maxDimension = 1800;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close?.();
        return file;
      }
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();

      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.86));
      if (!blob || blob.size >= file.size) return file;

      const baseName = file.name.replace(/\.[^.]+$/, "") || "product-image";
      return new File([blob], `${baseName}.webp`, {
        type: "image/webp",
        lastModified: Date.now()
      });
    } catch {
      return file;
    }
  }

  async function uploadImages(filesToUpload) {
    const urls = [];
    const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"];

    try {
      for (const file of filesToUpload) {
        if (!supportedTypes.includes(file.type) && !/\.(jpe?g|png|webp|avif|heic|heif)$/i.test(file.name)) {
          throw new Error(`Формат файла «${file.name}» не поддерживается.`);
        }
        if (file.size > 8 * 1024 * 1024) {
          throw new Error(`Файл «${file.name}» больше 8 МБ.`);
        }

        const uploadFile = await optimizeImage(file);
        if (["image/heic", "image/heif"].includes(uploadFile.type)) throw new Error("Фото HEIC не удалось преобразовать. На iPhone выберите JPEG или включите «Наиболее совместимый» в настройках камеры.");
        const safeName = uploadFile.name.toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "image";
        const path = `${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}-${safeName}`;
        const { error } = await supabase.storage.from("product-images").upload(path, uploadFile, {
          cacheControl: "31536000",
          upsert: false,
          contentType: uploadFile.type
        });
        if (error) throw new Error(`Не удалось загрузить ${file.name}: ${error.message}`);

        const { data } = supabase.storage.from("product-images").getPublicUrl(path);
        urls.push(data.publicUrl);
      }
      return urls;
    } catch (error) {
      // Avoid leaving orphaned files if a later upload in the batch fails.
      if (urls.length) await removeStorageImages(urls);
      throw error;
    }
  }

  function storagePathFromPublicUrl(url) {
    try {
      const parsed = new URL(url);
      const marker = "/storage/v1/object/public/product-images/";
      const index = parsed.pathname.indexOf(marker);
      return index >= 0 ? decodeURIComponent(parsed.pathname.slice(index + marker.length)) : null;
    } catch { return null; }
  }

  async function removeStorageImages(urls) {
    const paths = urls.map(storagePathFromPublicUrl).filter(Boolean);
    if (!paths.length) return;
    const { error } = await supabase.storage.from("product-images").remove(paths);
    if (error) console.warn("Не удалось удалить некоторые изображения из хранилища:", error.message);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("save-button");
    button.disabled = true;
    setMessage(formMessage, "Сохраняем товар…");
    let newlyUploaded = [];
    try {
      const name = $("name").value.trim();
      const price = Number($("price").value);
      if (!name) throw new Error("Укажите название товара.");
      if (!Number.isFinite(price) || price < 0) throw new Error("Цена должна быть неотрицательным числом.");
      const selectedFiles = Array.from($("images").files || []);
      if (selectedFiles.length > 8) throw new Error("За один раз можно выбрать не больше 8 фотографий.");
      newlyUploaded = await uploadImages(selectedFiles);
      const characteristics = parseCharacteristics($("characteristics").value);
      const productData = {
        name,
        price,
        description: $("description").value.trim(),
        characteristics,
        available: $("available").checked,
        images: [...currentImages, ...newlyUploaded]
      };
      if (productData.images.length > 12) throw new Error("У товара может быть не больше 12 фотографий.");
      const productId = $("product-id").value;
      let result;
      if (productId) {
        result = await supabase.from("products").update(productData).eq("id", productId).select().single();
      } else {
        result = await supabase.from("products").insert(productData).select().single();
      }
      if (result.error) throw result.error;

      const previous = products.find(item => String(item.id) === String(productId));
      const previousImages = previous && Array.isArray(previous.images) ? previous.images : [];
      const removedImages = previousImages.filter(url => !productData.images.includes(url));
      await removeStorageImages(removedImages);
      form.reset();
      $("available").checked = true;
      resetFormState();
      setMessage(formMessage, "Товар сохранён. Каталог обновлён.", "success");
      if (!productId) adminPage = 1;
      await loadProducts();
    } catch (error) {
      if (newlyUploaded.length) await removeStorageImages(newlyUploaded);
      setMessage(formMessage, "Ошибка: " + (error.message || String(error)), "error");
    } finally {
      button.disabled = false;
    }
  });

  async function deleteProduct(product) {
    if (!confirm(`Удалить товар «${product.name}»? Это действие нельзя отменить.`)) return;
    setMessage(listMessage, "Удаляем товар…");
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) {
      setMessage(listMessage, "Не удалось удалить товар: " + error.message, "error");
      return;
    }
    await removeStorageImages(Array.isArray(product.images) ? product.images : []);
    if (String($("product-id").value) === String(product.id)) {
      form.reset();
      resetFormState();
    }
    setMessage(listMessage, "Товар удалён.", "success");
    await loadProducts();
  }

  (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await showDashboard();
  })();
})();
