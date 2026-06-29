(function () {
  "use strict";

  const OPTIONAL_SERVICES = [
    "0000ff00-0000-1000-8000-00805f9b34fb",
    "0000ffe0-0000-1000-8000-00805f9b34fb",
    "000018f0-0000-1000-8000-00805f9b34fb",
    "0000ae30-0000-1000-8000-00805f9b34fb",
    "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    "e7810a71-73ae-499d-8c15-faa9aef0c3f2"
  ];

  let device = null;
  let characteristic = null;
  let printing = false;

  function dispatchStatus(state, message) {
    window.dispatchEvent(new CustomEvent("thermal-printer-status", {
      detail: {
        state,
        message,
        deviceId: device?.id || "",
        deviceName: device?.name || ""
      }
    }));
  }

  function isSupported() {
    return Boolean(navigator.bluetooth && window.isSecureContext);
  }

  function isConnected() {
    return Boolean(device?.gatt?.connected && characteristic);
  }

  function isPrinting() {
    return printing;
  }

  function getDeviceInfo() {
    return {
      id: device?.id || "",
      name: device?.name || "",
      connected: isConnected()
    };
  }

  function handleDisconnect() {
    characteristic = null;
    dispatchStatus("disconnected", device?.name ? `${device.name} 已断开` : "打印机已断开");
  }

  async function findWritableCharacteristic(server) {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      const writable = characteristics.find((item) =>
        item.properties.writeWithoutResponse || item.properties.write
      );
      if (writable) return writable;
    }
    throw new Error("找不到可写入的蓝牙打印通道");
  }

  async function connectDevice(targetDevice) {
    if (!targetDevice) throw new Error("尚未选择打印机");
    device = targetDevice;
    device.removeEventListener("gattserverdisconnected", handleDisconnect);
    device.addEventListener("gattserverdisconnected", handleDisconnect);
    dispatchStatus("connecting", `正在连接 ${device.name || "蓝牙打印机"}...`);
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    characteristic = await findWritableCharacteristic(server);
    dispatchStatus("connected", `${device.name || "蓝牙打印机"} 已连接`);
    return getDeviceInfo();
  }

  async function pair() {
    if (!isSupported()) {
      throw new Error("此浏览器不支持蓝牙直连，请使用 Android 或电脑的 Chrome / Edge");
    }
    const selected = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: OPTIONAL_SERVICES
    });
    return connectDevice(selected);
  }

  async function reconnect(savedDeviceId = "") {
    if (!isSupported()) {
      throw new Error("此浏览器不支持蓝牙直连，请使用 Android 或电脑的 Chrome / Edge");
    }
    if (device) return connectDevice(device);
    if (typeof navigator.bluetooth.getDevices !== "function") {
      throw new Error("浏览器无法恢复已配对设备，请点击“配对 / 更换”");
    }
    const devices = await navigator.bluetooth.getDevices();
    const remembered = devices.find((item) => item.id === savedDeviceId) || devices[0];
    if (!remembered) throw new Error("没有已配对打印机，请先点击“配对 / 更换”");
    return connectDevice(remembered);
  }

  async function restore(savedDeviceId = "") {
    if (!isSupported() || typeof navigator.bluetooth.getDevices !== "function") return null;
    const devices = await navigator.bluetooth.getDevices();
    const remembered = devices.find((item) => item.id === savedDeviceId);
    if (!remembered) return null;
    device = remembered;
    device.addEventListener("gattserverdisconnected", handleDisconnect);
    dispatchStatus("remembered", `已配对 ${device.name || "蓝牙打印机"}，等待连接`);
    return getDeviceInfo();
  }

  async function disconnect() {
    if (device?.gatt?.connected) device.gatt.disconnect();
    characteristic = null;
    dispatchStatus("disconnected", "打印机已断开");
  }

  async function forget() {
    await disconnect();
    if (device && typeof device.forget === "function") await device.forget();
    device = null;
    dispatchStatus("idle", "尚未连接打印机");
  }

  function wrapCanvasLine(context, text, maxWidth) {
    if (!text) return [""];
    const output = [];
    let line = "";
    for (const character of Array.from(text)) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        output.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    if (line) output.push(line);
    return output;
  }

  function renderLinesToRaster(lines, paperWidth) {
    const width = paperWidth === "80" ? 576 : 384;
    const padding = paperWidth === "80" ? 24 : 16;
    const fontSize = paperWidth === "80" ? 28 : 24;
    const lineHeight = fontSize + 10;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.font = `${fontSize}px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
    const wrappedLines = [];
    lines.forEach((text, index) => {
      wrapCanvasLine(context, String(text), width - padding * 2).forEach((line) => {
        wrappedLines.push({ text: line, centered: index === 0 });
      });
    });

    canvas.width = width;
    canvas.height = Math.max(120, padding * 2 + wrappedLines.length * lineHeight + 24);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000";
    context.font = `${fontSize}px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
    context.textBaseline = "top";
    wrappedLines.forEach((line, index) => {
      const y = padding + index * lineHeight;
      const x = line.centered
        ? Math.max(padding, (width - context.measureText(line.text).width) / 2)
        : padding;
      context.fillText(line.text, x, y);
    });

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const bytesPerRow = Math.ceil(canvas.width / 8);
    const raster = new Uint8Array(bytesPerRow * canvas.height);
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const pixelIndex = (y * canvas.width + x) * 4;
        const luminance = pixels[pixelIndex] * 0.299
          + pixels[pixelIndex + 1] * 0.587
          + pixels[pixelIndex + 2] * 0.114;
        if (pixels[pixelIndex + 3] > 0 && luminance < 170) {
          raster[y * bytesPerRow + Math.floor(x / 8)] |= 0x80 >> (x % 8);
        }
      }
    }
    return { raster, bytesPerRow, height: canvas.height };
  }

  function buildEscPosPayload(lines, paperWidth) {
    const { raster, bytesPerRow, height } = renderLinesToRaster(lines, paperWidth);
    const header = new Uint8Array([
      0x1b, 0x40,
      0x1b, 0x61, 0x01,
      0x1d, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff
    ]);
    const footer = new Uint8Array([
      0x1b, 0x64, 0x04,
      0x1d, 0x56, 0x42, 0x00
    ]);
    const payload = new Uint8Array(header.length + raster.length + footer.length);
    payload.set(header, 0);
    payload.set(raster, header.length);
    payload.set(footer, header.length + raster.length);
    return payload;
  }

  async function writeChunk(chunk) {
    if (characteristic.properties.writeWithoutResponse
      && typeof characteristic.writeValueWithoutResponse === "function") {
      await characteristic.writeValueWithoutResponse(chunk);
      return;
    }
    if (typeof characteristic.writeValueWithResponse === "function") {
      await characteristic.writeValueWithResponse(chunk);
      return;
    }
    await characteristic.writeValue(chunk);
  }

  async function printLines(lines, paperWidth = "58") {
    if (printing) throw new Error("上一张小票仍在打印");
    if (!isConnected()) throw new Error("蓝牙打印机尚未连接");
    printing = true;
    dispatchStatus("printing", "正在发送小票，请稍候...");
    try {
      const payload = buildEscPosPayload(lines, paperWidth);
      const chunkSize = 20;
      let lastProgress = 0;
      for (let offset = 0, part = 0; offset < payload.length; offset += chunkSize, part += 1) {
        await writeChunk(payload.slice(offset, offset + chunkSize));
        const progress = Math.floor(((offset + chunkSize) / payload.length) * 10) * 10;
        if (progress >= lastProgress + 20 && progress < 100) {
          lastProgress = progress;
          dispatchStatus("printing", `正在发送小票 ${progress}%`);
        }
        if (part > 0 && part % 30 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 12));
        }
      }
      dispatchStatus("connected", `${device?.name || "蓝牙打印机"} 打印完成`);
    } finally {
      printing = false;
    }
  }

  window.thermalPrinter = {
    isSupported,
    isConnected,
    isPrinting,
    getDeviceInfo,
    pair,
    reconnect,
    restore,
    disconnect,
    forget,
    printLines
  };
})();
