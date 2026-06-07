// Catalogo desde el Shopify de CAROTA (products.json). Cache en memoria para no
// pegarle a Shopify en cada carga del panel.
const STORE = 'https://carotaus.com';
const TTL_MS = 5 * 60 * 1000; // 5 min

let cache = { at: 0, data: null };

// Deriva el "wash" del titulo: "Dusk Wash Denim Short" -> "dusk".
function washFromTitle(title = '') {
  const m = title.match(/^(\w+)\s+wash/i);
  return m ? m[1].toLowerCase() : null;
}

function normalize(p) {
  const images = (p.images || []).map((img) => img.src);
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    wash: washFromTitle(p.title),
    productType: p.product_type || null,
    price: p.variants?.[0]?.price || null,
    image: images[0] || null, // foto principal -> source para generar
    images,
  };
}

export async function fetchProducts({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < TTL_MS) {
    return cache.data;
  }
  const res = await fetch(`${STORE}/products.json?limit=250`);
  if (!res.ok) {
    throw new Error(`Shopify products.json fallo (${res.status})`);
  }
  const json = await res.json();
  const products = (json.products || []).map(normalize).filter((p) => p.image);
  cache = { at: now, data: products };
  return products;
}
