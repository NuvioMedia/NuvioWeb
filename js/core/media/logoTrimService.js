const trimCache = new Map();

function trimLogoUrl(url) {
  if (trimCache.has(url)) {
    return trimCache.get(url);
  }

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        let minX = canvas.width, maxX = 0, minY = canvas.height, maxY = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3] > 0) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (maxX < minX || maxY < minY) {
          resolve(null);
          return;
        }

        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
        resolve(out.toDataURL());
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });

  trimCache.set(url, promise);
  return promise;
}

export function applyLogoTrim(imgEl) {
  if (!(imgEl instanceof HTMLImageElement)) return;
  const src = imgEl._heroLogoOrigSrc || imgEl.getAttribute("src");
  if (!src || src.startsWith("data:")) return;

  trimLogoUrl(src).then((trimmed) => {
    if (!trimmed) return;
    const currentOrigSrc = imgEl._heroLogoOrigSrc || imgEl.getAttribute("src");
    if (currentOrigSrc !== src) return;
    imgEl._heroLogoOrigSrc = src;
    imgEl.setAttribute("src", trimmed);
  });
}
