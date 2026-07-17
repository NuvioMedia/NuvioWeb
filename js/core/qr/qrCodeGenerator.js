import encodeQR from "qr";

export const QrCodeGenerator = {
  generate(canvas, content, size = 512) {
    const matrix = encodeQR(content, "raw", { ecc: "medium", border: 4 });

    const ctx = canvas.getContext("2d");

    canvas.width = size;
    canvas.height = size;

    const cornerRadius = size * 0.06;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    this.roundRect(ctx, 0, 0, size, size, cornerRadius);
    ctx.clip();

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    const moduleCount = matrix.length;
    const moduleSize = size / moduleCount;
    const moduleRadius = moduleSize * 0.08;

    ctx.fillStyle = "#000000";

    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (matrix[row][col]) {
          const x = col * moduleSize;
          const y = row * moduleSize;

          this.roundRect(ctx, x, y, moduleSize, moduleSize, moduleRadius);

          ctx.fill();
        }
      }
    }
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
