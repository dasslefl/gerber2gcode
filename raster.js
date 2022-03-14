#!/usr/bin/env node
"use strict"

const yargs = require('yargs');
const jimp = require('jimp');

const fs = require('fs');

const argv = yargs(process.argv.slice(2))
    .option('image', {
        alias: 'i',
        description: 'Bilddatei, die verarbeitet werden soll',
        demandOption: true,
        type: 'string'
    })
    .option('density', {
        alias: 'd',
        description: 'DPI der Bilddatei',
        demandOption: true,
        type: 'number'
    })
    .option('output', {
        alias: 'o',
        description: 'Dateiname der Ausgabe',
        demandOption: true,
        type: 'string'
    })
    .help()
    .alias('help', 'h')
    .argv;

async function main() {
    console.log("raster.js - Lade " + argv.image);

    if(!fs.existsSync(argv.image)) {
        console.log("Datei " + argv.image + " konnte nicht gefunden werden.");
        process.exit(1);
    }

    const png = await jimp.read(argv.image);

    console.log(`Bildauflösung: ${png.bitmap.width}x${png.bitmap.height}`);
    console.log(`Ausgabedatei: ${argv.output}`);

    const fd = fs.openSync(argv.output, 'w');

    if(fd === -1) {
        console.log("Datei " + argv.image + " konnte nicht gefunden werden.");
        process.exit(1);
    }

    // Rastern für arme
    const dpmm = argv.density / 25.4;

    const widthpx = png.bitmap.width;
    const widthmm = png.bitmap.width / dpmm;

    const heightpx = png.bitmap.height;
    const heightmm = png.bitmap.height / dpmm;

    const rasterWidth = 0.1;
    const overburn = 2;
    const overscan = 5 + overburn;

    const laserPower = 255;
    const feedRate = 2000;

    // Inline Funktionen um die consts zu übernehmen
    function appendLine(line = "") {
        fs.writeSync(fd, line + "\n");
    }

    function pixelTomm(pixel) {
        return pixel / dpmm;
    }

    function mmToPixel(mm) {
        return Math.floor(mm * dpmm);
    }

    function shouldBurnPixel(x, y) {

        if(x < 0 || x > widthpx)  return true;
        if(y < 0 || y > heightpx) return true;

        const color = png.getPixelColor(x, heightpx - 1 - y); // Y-Achse umkehren, damit KS kartesisch

        const red   = (color & 0xFF000000) >>> 24;
        const green = (color & 0x00FF0000) >>> 16;
        const blue  = (color & 0x0000FF00) >>>  8;

        if(red > 10 || green > 10 || blue > 10) return false;
        else                                    return true;
    }

    appendLine(`; Rastered from ${argv.image}`);
    appendLine(`; Resulution of source: ${widthpx}x${heightpx} at ${argv.density}dpi (${dpmm}dpmm)`);
    appendLine(`; Board size: ${widthmm}x${heightmm}mm`);
    appendLine();

    appendLine(`G21         ; Set units to mm`);
    appendLine(`G90         ; Absolute positioning`);
    appendLine(`$32=1       ; GRBL Laser Mode on`);
    appendLine(`M4 S0       ; Enable Laser/Spindle (0 power)`);
    appendLine();

    const overburnPx = mmToPixel(overburn);

    for(let y = -overburnPx; y < heightpx + overburnPx; y += mmToPixel(rasterWidth)) {
        // Raster-Zeile starten
        appendLine(`G0 X-${overscan} Y${pixelTomm(y)}`);
        appendLine(`G1 X-${overburn} Y${pixelTomm(y)} S0 F${feedRate}`);

        let oldState = shouldBurnPixel(0, y);

        for(let x = -overburnPx; x < widthpx + overburnPx; x++) {
            const newState = shouldBurnPixel(x, y);

            if(newState && !oldState) { // Laser war aus, soll nun eingeschalten werden -> in Bewegung ist Laser aus
                appendLine(`X${pixelTomm(x)} S0`);
                oldState = newState;
            }
            if(!newState && oldState) { // Laser war an, soll nun ausgeschalten werden -> in Bewegung ist Laser an
                appendLine(`X${pixelTomm(x)} S${laserPower}`);
                oldState = newState;
            }
        }
        // Ende Raster-Zeile
        appendLine(`X${widthmm + overburn} S${oldState ? laserPower : 0}`);
        appendLine(`X${widthmm + overscan} S0`);
        appendLine();
    }

    appendLine(`M5          ; Laser off`);
    appendLine(`G0 X0 Y0    ; Return to zero`);

    fs.closeSync(fd);
}

main();