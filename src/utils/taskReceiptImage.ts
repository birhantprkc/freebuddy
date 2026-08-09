export interface TaskReceiptImageCopy {
  brand: string;
  title: string;
  completed: string;
  itemUnit: string;
  streak: string;
  dayUnit: string;
  completionRate: string;
  approved: string;
}

export interface TaskReceiptImageData {
  dateLabel: string;
  successCount: number;
  streakDays: number;
  completionRate: number;
  tasks: string[];
  copy: TaskReceiptImageCopy;
}

export interface TaskReceiptImageAssets {
  logoUrl: string;
  petUrl: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load receipt asset: ${url}`));
    image.src = url;
  });
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawCenteredText(
  context: CanvasRenderingContext2D,
  value: string,
  centerX: number,
  y: number
) {
  context.textAlign = "center";
  context.fillText(value, centerX, y);
  context.textAlign = "left";
}

function truncateCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number
): string {
  if (context.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

export async function renderTaskReceiptPng(
  data: TaskReceiptImageData,
  assets: TaskReceiptImageAssets
): Promise<string> {
  const [logo, pet] = await Promise.all([
    loadImage(assets.logoUrl),
    loadImage(assets.petUrl)
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");

  context.fillStyle = "#f7fbf9";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.shadowColor = "rgba(15, 23, 42, 0.12)";
  context.shadowBlur = 36;
  context.shadowOffsetY = 18;
  roundedRect(context, 100, 70, 880, 1300, 34);
  context.fillStyle = "#ffffff";
  context.fill();
  context.restore();
  roundedRect(context, 100, 70, 880, 1300, 34);
  context.strokeStyle = "#dbe5e1";
  context.lineWidth = 2;
  context.stroke();

  context.strokeStyle = "#cde8dc";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(190, 153);
  context.lineTo(352, 153);
  context.moveTo(728, 153);
  context.lineTo(890, 153);
  context.stroke();
  context.drawImage(logo, 370, 126, 54, 54);
  context.fillStyle = "#0f172a";
  context.font = '700 33px "Plus Jakarta Sans", "PingFang SC", sans-serif';
  context.fillText(data.copy.brand, 440, 166);

  context.fillStyle = "#0f172a";
  context.font = '700 62px "Plus Jakarta Sans", "PingFang SC", sans-serif';
  drawCenteredText(context, data.copy.title, 540, 286);

  context.setLineDash([4, 14]);
  context.strokeStyle = "#d8e1de";
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(132, 340);
  context.lineTo(948, 340);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = "#334155";
  context.font = '500 28px "PingFang SC", sans-serif';
  drawCenteredText(context, data.copy.completed, 540, 424);
  context.fillStyle = "#10b981";
  context.font = '750 128px "Plus Jakarta Sans", sans-serif';
  drawCenteredText(context, String(data.successCount), 514, 558);
  context.font = '700 34px "PingFang SC", sans-serif';
  context.fillText(data.copy.itemUnit, 585, 548);

  const listTop = 636;
  const rowHeight = 82;
  roundedRect(context, 160, listTop, 760, rowHeight * 3 + 12, 22);
  context.fillStyle = "#fbfdfc";
  context.fill();
  context.strokeStyle = "#e2e8e5";
  context.lineWidth = 2;
  context.stroke();
  const tasks = data.tasks.slice(0, 3);
  for (let index = 0; index < 3; index += 1) {
    const y = listTop + 58 + index * rowHeight;
    if (index > 0) {
      context.strokeStyle = "#e5ebe8";
      context.setLineDash([7, 8]);
      context.beginPath();
      context.moveTo(190, y - 44);
      context.lineTo(890, y - 44);
      context.stroke();
      context.setLineDash([]);
    }
    context.beginPath();
    context.arc(204, y - 8, 13, 0, Math.PI * 2);
    context.fillStyle = "#10b981";
    context.fill();
    context.fillStyle = tasks[index] ? "#1e293b" : "#94a3b8";
    context.font = '500 28px "PingFang SC", sans-serif';
    context.fillText(
      truncateCanvasText(context, tasks[index] ?? "—", 610),
      244,
      y
    );
  }

  roundedRect(context, 160, 946, 760, 170, 24);
  context.fillStyle = "#f0faf6";
  context.fill();
  context.fillStyle = "#64748b";
  context.font = '500 24px "PingFang SC", sans-serif';
  drawCenteredText(context, data.copy.streak, 344, 1000);
  drawCenteredText(context, data.copy.completionRate, 618, 1000);
  context.fillStyle = "#10b981";
  context.font = '700 48px "Plus Jakarta Sans", "PingFang SC", sans-serif';
  drawCenteredText(context, `${data.streakDays} ${data.copy.dayUnit}`, 344, 1070);
  drawCenteredText(context, `${data.completionRate}%`, 618, 1070);
  context.strokeStyle = "#cde8dc";
  context.beginPath();
  context.moveTo(480, 978);
  context.lineTo(480, 1084);
  context.stroke();

  context.save();
  context.globalAlpha = 0.98;
  context.drawImage(pet, 694, 1028, 250, 250);
  context.restore();

  context.save();
  context.translate(760, 972);
  context.rotate(-0.12);
  context.strokeStyle = "#10b981";
  context.lineWidth = 5;
  context.beginPath();
  context.arc(0, 0, 72, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(0, 0, 60, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#059669";
  context.font = '700 18px "Plus Jakarta Sans", "PingFang SC", sans-serif';
  context.textAlign = "center";
  context.fillText("ButlerBuddy", 0, -7);
  context.font = '700 17px "PingFang SC", sans-serif';
  context.fillText(data.copy.approved, 0, 22);
  context.restore();

  context.fillStyle = "#94a3b8";
  context.font = '500 22px "PingFang SC", sans-serif';
  context.fillText(data.dateLabel, 158, 1287);

  return canvas.toDataURL("image/png");
}
