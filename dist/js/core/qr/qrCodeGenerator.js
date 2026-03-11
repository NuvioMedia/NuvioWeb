// js/core/qr/qrCodeGenerator.js

export const QrCodeGenerator = {

  generate(canvas, content, size = 512) {

    const qr = qrcode(0, 'M');
    qr.addData(content);
    qr.make();

    const ctx = canvas.getContext("2d");

    canvas.width = size;
    canvas.height = size;

    // === 1️⃣ Sfondo bianco arrotondato ===
    const cornerRadius = size * 0.06;

    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = "#ffffff";
    this.roundRect(ctx, 0, 0, size, size, cornerRadius);
    ctx.fill();

    // === 2️⃣ Disegno moduli arrotondati ===
    const moduleCount = qr.getModuleCount();
    const moduleSize = size / moduleCount;
    const moduleRadius = moduleSize * 0.3;

    ctx.fillStyle = "#000000";

    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {

        if (qr.isDark(row, col)) {

          const x = col * moduleSize;
          const y = row * moduleSize;

          this.roundRect(
            ctx,
            x,
            y,
            moduleSize,
            moduleSize,
            moduleRadius
          );

          ctx.fill();
        }
      }
    }

    // === 3️⃣ Clip finale arrotondato ===
    const imageData = ctx.getImageData(0, 0, size, size);

    ctx.clearRect(0, 0, size, size);

    ctx.save();
    this.roundRect(ctx, 0, 0, size, size, cornerRadius);
    ctx.clip();

    ctx.putImageData(imageData, 0, 0);
    ctx.restore();
  },

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

};