#target photoshop

/**
 * VISION3 50D - MASTER V62 (THE FINAL FORCE)
 * - Halation: Threshold 228, Opacidade 33%.
 * - Advanced Blending: Apenas Canal Vermelho (Exclui G e B).
 * - Blend If Split: Underlying Layer 83 / 175 (Sintaxe de Baixo Nível).
 * - Limpeza: Deleta máscaras brancas de todos os layers de ajuste.
 * - Hierarquia: Grão (6) no topo absoluto.
 */

var s2t = stringIDToTypeID;
var c2t = charIDToTypeID;

function main() {
    if (app.documents.length === 0) return;
    var doc = app.activeDocument;
    runV62Pipeline(doc);
}

function runV62Pipeline(doc) {
    var diag = Math.sqrt(Math.pow(doc.width.as("px"), 2) + Math.pow(doc.height.as("px"), 2));
    var resFactor = diag / 3500;

    var mainGroup = doc.layerSets.add();
    mainGroup.name = "KODAK VISION3 50D - MASTER";

    // 1. EXPOSIÇÃO (+0.1 EV)
    var expParams = new ActionDescriptor();
    expParams.putDouble(s2t("exposure"), 0.1);
    createAdjV62("exposure", "1. Exposure Compensation (+0.1)", mainGroup, expParams);

    // 2. DENSIDADE SUBTRATIVA (ECN-2)
    var selParams = new ActionDescriptor();
    selParams.putEnumerated(s2t("method"), s2t("selectiveColorMethod"), s2t("relative"));
    var listSel = new ActionList();
    var dRed = new ActionDescriptor();
    dRed.putEnumerated(s2t("colors"), s2t("colors"), s2t("reds"));
    dRed.putInteger(s2t("cyan"), 12); dRed.putInteger(s2t("black"), 18);
    listSel.putObject(s2t("selectiveColor"), dRed);
    selParams.putList(s2t("colorCorrection"), listSel);
    createAdjV62("selectiveColor", "2. Subtractive Density (ECN-2)", mainGroup, selParams);

    // 3 & 4. AÇÃO DO USUÁRIO (LUT + CURVAS)
    try {
        app.doAction("Calibracao", "VISION3");
        var layersToMove = [];
        for (var i = 0; i < 4; i++) {
            var l = doc.layers[i];
            if (l.kind == LayerKind.COLORLOOKUP) {
                l.name = "3. Kodak Vision3 50D LUT";
                layersToMove.push(l);
            }
            if (l.kind == LayerKind.CURVES) {
                l.name = "4. Highlight HDR Protection (altas)";
                l.opacity = 80;
                layersToMove.push(l);
            }
        }
        for (var k = 0; k < layersToMove.length; k++) {
            layersToMove[k].move(mainGroup, ElementPlacement.INSIDE);
        }
    } catch(e) {}

    // 5. HALATION ÓPTICO (A IMAGEM DEFINITIVA)
    createSmartHalationV62(doc, mainGroup, resFactor);

    // 6. GRÃO CINEMA (TOPO ABSOLUTO)
    var grain = createGrainV62(doc, mainGroup, resFactor);
    grain.name = "6. Film Grain (Fine ISO 50)";

    // LIMPEZA FINAL DE MÁSCARAS VAZIAS
    cleanAllMasksSafe(mainGroup);

    doc.selection.deselect();
    doc.activeLayer = mainGroup;

    // EXECUÇÃO DA AÇÃO FINAL CALIBRACAO2
    try {
        app.doAction("Calibracao2", "VISION3");
    } catch(e) {}
}

// --- ENGINE DE ESTILO (SINTAXE LITERAL SCRIPT-LISTENER) ---

function createSmartHalationV62(doc, group, resFactor) {
    try {
        var baseLayer = doc.artLayers[doc.artLayers.length - 1];
        var halLayer = baseLayer.duplicate();
        halLayer.name = "5. Optical Halation (Smart Object)";
        halLayer.move(group, ElementPlacement.INSIDE);
        doc.activeLayer = halLayer;

        // Converter em Smart Object
        var descSO = new ActionDescriptor();
        var refSO = new ActionReference();
        refSO.putEnumerated(c2t("Lyr "), c2t("Ordn"), c2t("Trgt"));
        descSO.putReference(c2t("null"), refSO);
        executeAction(s2t("newPlacedLayer"), descSO, DialogModes.NO);

        // Filtros Inteligentes
        var desc2 = new ActionDescriptor();
        desc2.putInteger(c2t("Lvl "), 228); 
        executeAction(c2t("Thrs"), desc2, DialogModes.NO);

        var desc3 = new ActionDescriptor();
        desc3.putUnitDouble(c2t("Rds "), s2t("pixelsUnit"), 2.5 * resFactor);
        executeAction(c2t("Mxm "), desc3, DialogModes.NO);

        var desc4 = new ActionDescriptor();
        desc4.putUnitDouble(c2t("Rds "), s2t("pixelsUnit"), 18 * resFactor);
        executeAction(s2t("gaussianBlur"), desc4, DialogModes.NO);

        // CONFIGURAÇÕES DE MESCLAGEM (REPRODUÇÃO DA IMAGEM)
        var desc5 = new ActionDescriptor();
        var ref5 = new ActionReference();
        ref5.putEnumerated(c2t("Lyr "), c2t("Ordn"), c2t("Trgt"));
        desc5.putReference(c2t("null"), ref5);
        
        var ldesc = new ActionDescriptor();
        ldesc.putEnumerated(c2t("Md  "), c2t("BlnM"), c2t("Scrn")); // Screen
        ldesc.putUnitDouble(c2t("Opct"), c2t("#Prc"), 33.0);      // 33% Opacity
        
        // Advanced Blending: Desmarcar G e B
        var listRestr = new ActionList();
        listRestr.putEnumerated(c2t("Chnl"), c2t("Chnl"), c2t("Grn "));
        listRestr.putEnumerated(c2t("Chnl"), c2t("Chnl"), c2t("Bl  "));
        ldesc.putList(s2t("channelRestrictions"), listRestr);

        // Blend If (Underlying Layer) Split 83 / 175
        var blendList = new ActionList();
        var bdesc = new ActionDescriptor();
        bdesc.putEnumerated(c2t("Chnl"), c2t("Chnl"), c2t("Gry "));
        bdesc.putInteger(c2t("srcB"), 0); bdesc.putInteger(c2t("srcM"), 0);
        bdesc.putInteger(c2t("srcW"), 255); bdesc.putInteger(c2t("srcT"), 255);
        bdesc.putInteger(c2t("dstB"), 83);  // Underlying Black Split 1
        bdesc.putInteger(c2t("dstM"), 175); // Underlying Black Split 2
        bdesc.putInteger(c2t("dstW"), 255); bdesc.putInteger(c2t("dstT"), 255);
        blendList.putObject(c2t("Blnd"), bdesc);
        ldesc.putList(c2t("Blnd"), blendList);

        desc5.putObject(c2t("T   "), c2t("Lyr "), ldesc);
        executeAction(c2t("setd"), desc5, DialogModes.NO);

    } catch(e) {}
}

function createGrainV62(doc, group, resFactor) {
    var grain = doc.artLayers.add();
    grain.move(group, ElementPlacement.INSIDE);
    doc.activeLayer = grain;
    fillColorV62(128, 128, 128);
    var idAddN = s2t("addNoise");
    var descNoise = new ActionDescriptor();
    descNoise.putUnitDouble(c2t("Amnt"), c2t("#Prc"), 15);
    descNoise.putBoolean(c2t("Mnch"), true);
    executeAction(idAddN, descNoise, DialogModes.NO);
    var scale = 100 * (resFactor < 1 ? 1 : resFactor * 1.2);
    grain.resize(scale, scale, AnchorPosition.MIDDLECENTER);
    grain.applyGaussianBlur(0.12 * resFactor);
    grain.blendMode = BlendMode.OVERLAY;
    grain.opacity = 35;
    return grain;
}

function createAdjV62(type, name, group, params) {
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(s2t("adjustmentLayer"));
    desc.putReference(c2t("null"), ref);
    var descUsng = new ActionDescriptor();
    descUsng.putClass(c2t("Type"), s2t(type));
    desc.putObject(c2t("Usng"), s2t("adjustmentLayer"), descUsng);
    executeAction(s2t("make"), desc, DialogModes.NO);
    var l = app.activeDocument.activeLayer;
    l.name = name;
    l.move(group, ElementPlacement.INSIDE);
    var descSet = new ActionDescriptor();
    var refSet = new ActionReference();
    refSet.putEnumerated(s2t("adjustmentLayer"), c2t("Ordn"), c2t("Trgt"));
    descSet.putReference(c2t("null"), refSet);
    descSet.putObject(s2t("to"), s2t(type), params);
    executeAction(s2t("set"), descSet, DialogModes.NO);
}

function cleanAllMasksSafe(group) {
    var layers = group.layers;
    for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (l.kind != LayerKind.NORMAL && l.kind != LayerKind.SMARTOBJECT) {
            try {
                app.activeDocument.activeLayer = l;
                var desc = new ActionDescriptor();
                var ref = new ActionReference();
                ref.putEnumerated(c2t("Chnl"), c2t("Chnl"), c2t("Msk "));
                desc.putReference(c2t("null"), ref);
                executeAction(c2t("Dlt "), desc, DialogModes.NO);
            } catch(e) {}
        }
    }
}

function fillColorV62(r, g, b) {
    var color = new SolidColor();
    color.rgb.red = r; color.rgb.green = g; color.rgb.blue = b;
    app.activeDocument.selection.selectAll();
    app.activeDocument.selection.fill(color);
}

main();
