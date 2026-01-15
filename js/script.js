// --- ARQUIVO JS (Lógica do Sistema Atualizada) ---

// --- LOGICA DE TEMA ---
function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');
    const icon = document.getElementById('themeIcon');

    if (isDark) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        icon.setAttribute('data-lucide', 'moon');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        icon.setAttribute('data-lucide', 'sun');
    }
    lucide.createIcons();
    render();
}

(function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const icon = document.getElementById('themeIcon');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        if (icon) icon.setAttribute('data-lucide', 'sun');
    } else {
        document.documentElement.classList.remove('dark');
        if (icon) icon.setAttribute('data-lucide', 'moon');
    }
})();

// --- 1. DADOS E CONSTANTES ---
const BOTTLE_TYPES = {
    'LN330': { id: 'LN330', label: 'Longneck 330ml', volumeHl: 0.00330, palletSize: 2016 },
    'LN275': { id: 'LN275', label: 'Longneck 275ml', volumeHl: 0.00275, palletSize: 2184 }
};

const state = {
    currentSku: 'LN330',
    manualInputs: {
        depalletizer: 0,
        ebi: 0,
        filler: 0,
        fbi: 0,
        labeler: 0,
        labelInspector: 0,
        packer1: 0,
        packer2: 0,
        palletizer: 0,
        wrapper: 0 // Nova etapa: Envolvedora
    },
    // Controle de Vazão
    processFlowStart: 0,
    processFlowEnd: 0,
    processUnit: 'hL',

    rejects: {
        depalletizer: 0,
        ebi: 0,
        filler: 0,
        fbi: 0,
        labeler: 0,
        labelInspector: 0,
        packer1: 0,
        packer2: 0,
        palletizer: 0,
        wrapper: 0
    },
    costs: {
        liquidHl: 50.00,
        glass: 0.50,
        crown: 0.05,
        labelFront: 0.08,
        labelBack: 0.08,
        labelNeck: 0.04,
        sixPackCard: 0.30,
        shrinkFilm: 0.50
    }
};

state.runMode = 'mixed';

const demoPresets = {
    manualInputs: {
        depalletizer: 1214301,
        ebi: 1216540,
        filler: 1211658,
        fbi: 1210828,
        labeler: 1209097,
        labelInspector: 1200847,
        packer1: 1199160,
        packer2: 1199160,
        palletizer: 1199160,
        wrapper: 1199160
    },
    rejects: {
        depalletizer: 50,
        ebi: 4950,
        filler: 830,
        fbi: 745,
        labeler: 8350,
        labelInspector: 0,
        packer1: 0,
        packer2: 0,
        palletizer: 0,
        wrapper: 0
    },
    processFlowStart: 12500.00,
    processFlowEnd: 16550.00
};

// --- 2. ENGINE DE CÁLCULO ---
function calculateMetrics() {
    const bottle = BOTTLE_TYPES[state.currentSku];
    const c = state.costs;

    const costLiquid = bottle.volumeHl * c.liquidHl;
    const costLabels = c.labelFront + c.labelBack + c.labelNeck;
    const costSixPack = c.sixPackCard / 6;
    const costShrink = c.shrinkFilm / 24;

    // Definição dos Estágios com Fatores de Conversão para Input
    // conversionFactor: Número pelo qual a entrada visual deve ser multiplicada para obter garrafas
    const stagesDef = [
        { id: 'depalletizer', label: '1. Despaletizadora', type: 'process', lossValue: c.glass },
        { id: 'ebi', label: '2. Inspetor Vazias', type: 'quality', lossValue: c.glass },
        { id: 'filler', label: '3. Envasadora', type: 'process', lossValue: c.glass + costLiquid + c.crown, rejectLabel: 'Retirada PTP' },
        { id: 'fbi', label: '4. Inspetor Cheias', type: 'quality', lossValue: c.glass + costLiquid + c.crown },
        { id: 'labeler', label: '5. Rotuladora', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels },
        { id: 'labelInspector', label: '6. Inspetor Rótulo', type: 'quality', lossValue: c.glass + costLiquid + c.crown + costLabels },
        // Alteração: Empacotadora 1 em Pacotes de 6
        { id: 'packer1', label: '7. Empacotadora 1', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels + costSixPack, inputUnit: 'Pacotes (6)', conversion: 6 },
        // Alteração: EPC2 em Fardos de 24
        { id: 'packer2', label: '8. EPC2 (Shrink)', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels + costSixPack + costShrink, inputUnit: 'Fardos (24)', conversion: 24 },
        // Alteração: Paletizadora em Fardos de 24
        { id: 'palletizer', label: '9. Paletizadora', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels + costSixPack + costShrink, inputUnit: 'Fardos (24)', conversion: 24 },
        // Nova Etapa: Envolvedora em Paletes
        { id: 'wrapper', label: '10. Envolvedora', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels + costSixPack + costShrink, inputUnit: 'Paletes', conversion: bottle.palletSize }
    ];

    let currentVolume = state.manualInputs['depalletizer'] || 0;
    const initialVolume = currentVolume;

    let totalFinancialLoss = 0;
    let totalVolumeLostHl = 0;
    let flowData = [];
    let fillerInputCount = 0;

    stagesDef.forEach((stage, index) => {
        let stageInput = currentVolume; // Valor em Garrafas

        if (index > 0 && state.manualInputs[stage.id] !== undefined) {
            stageInput = state.manualInputs[stage.id];
        }

        if (stage.id === 'filler') fillerInputCount = stageInput;

        const rejectCount = state.rejects[stage.id] || 0;
        const stepLoss = rejectCount * stage.lossValue;
        totalFinancialLoss += stepLoss;

        const hasLiquid = ['filler', 'fbi', 'labeler', 'labelInspector', 'packer1', 'packer2', 'palletizer', 'wrapper'].includes(stage.id);
        if (hasLiquid) totalVolumeLostHl += rejectCount * bottle.volumeHl;

        // Cálculo de Produção OK
        const producedOk = stageInput - rejectCount;

        flowData.push({
            ...stage,
            in: stageInput,
            rejects: rejectCount,
            ok: producedOk, // Novo campo calculado
            financialLoss: stepLoss,
            out: producedOk, // Saída para próxima etapa
            isManual: state.manualInputs[stage.id] !== undefined
        });

        currentVolume = producedOk;
    });

    // Lógica de Vazão
    const theoreticalLiquidNeededHl = fillerInputCount * bottle.volumeHl;
    let measuredFlowHl = 0;
    let displayStartHl = state.processFlowStart;
    let displayEndHl = state.processFlowEnd;

    if (state.runMode === 'manual') {
        measuredFlowHl = theoreticalLiquidNeededHl;
        displayEndHl = displayStartHl + measuredFlowHl;
    } else {
        if (state.processFlowEnd === null || state.processFlowEnd === 0) {
            const simulatedLoss = theoreticalLiquidNeededHl * 1.015;
            measuredFlowHl = simulatedLoss;
            displayEndHl = displayStartHl + simulatedLoss;
        } else {
            measuredFlowHl = Math.max(0, state.processFlowEnd - state.processFlowStart);
            displayEndHl = state.processFlowEnd;
        }
    }

    const processLossHl = Math.max(0, measuredFlowHl - theoreticalLiquidNeededHl);
    const processLossMoney = processLossHl * c.liquidHl;

    totalVolumeLostHl += processLossHl;
    totalFinancialLoss += processLossMoney;

    const finalProduction = currentVolume;
    const efficiency = initialVolume > 0 ? (finalProduction / initialVolume) * 100 : 0;
    const pallets = finalProduction / bottle.palletSize;

    // Alertas
    const alerts = [];
    if (flowData[1].in > flowData[0].out) {
        const diff = flowData[1].in - flowData[0].out;
        alerts.push({ type: 'warning', title: 'Retorno de Garrafas (Re-loop)', msg: `EBI (+${formatNumber(diff)}) > Despaletizadora.`, icon: 'refresh-ccw' });
    }
    if (flowData[2].in > flowData[1].out) {
        const diff = flowData[2].in - flowData[1].out;
        alerts.push({ type: 'danger', title: 'QUEBRA DE PADRÃO', msg: `Envasadora (+${formatNumber(diff)}) > EBI OK. Risco de Qualidade!`, icon: 'alert-octagon' });
    }

    return {
        flow: flowData,
        financial: { total: totalFinancialLoss },
        liquid: {
            totalHl: totalVolumeLostHl, processLossHl, bottleLossHl: totalVolumeLostHl - processLossHl, processLossMoney,
            measuredFlowHl, displayStartHl, displayEndHl, theoreticalNeeded: theoreticalLiquidNeededHl
        },
        production: { bottles: finalProduction, pallets: pallets },
        efficiency: efficiency,
        alerts: alerts
    };
}

// --- 3. UI RENDERING ---
const formatCurrency = (val) => '$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatNumber = (val) => val.toLocaleString('pt-BR');
const formatVolume = (valHl) => {
    const isM3 = state.processUnit === 'm3';
    const val = isM3 ? (valHl / 10) : valHl;
    const unit = isM3 ? 'm³' : 'hL';
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + unit;
};
const getDisplayVolumeValue = (valHl) => (state.processUnit === 'm3' ? valHl / 10 : valHl).toFixed(2);

// Helper para converter garrafas para a unidade de exibição
const toDisplayUnit = (bottles, conversionFactor) => {
    if (!conversionFactor || conversionFactor === 1) return Math.round(bottles);
    return parseFloat((bottles / conversionFactor).toFixed(2)); // Exibe com casas decimais se for fração de pacote
};

function render() {
    const metrics = calculateMetrics();

    // Atualizar KPIs
    document.getElementById('kpiProduction').innerText = `${formatNumber(metrics.production.bottles)} un`;
    document.getElementById('kpiPallets').innerText = `${metrics.production.pallets.toFixed(1)} Paletes`;
    const effElem = document.getElementById('kpiEfficiency');
    effElem.innerText = `${metrics.efficiency.toFixed(2)}%`;
    effElem.className = `kpi-value ${metrics.efficiency > 90 ? 'kpi-eff-high' : 'kpi-eff-low'}`;
    document.getElementById('kpiIPE').innerText = metrics.liquid.totalHl.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' hL';
    document.getElementById('kpiIPEDetails').innerText = `Proc: ${metrics.liquid.processLossHl.toFixed(2)} + Garrafa: ${metrics.liquid.bottleLossHl.toFixed(2)}`;
    document.getElementById('kpiIPOW').innerText = formatCurrency(metrics.financial.total);
    document.getElementById('chartTotalLoss').innerText = formatCurrency(metrics.financial.total);

    // Alertas
    const alertsContainer = document.getElementById('alertsContainer');
    alertsContainer.innerHTML = metrics.alerts.map(alert => `
        <div class="${alert.type === 'danger' ? 'alert-danger-style' : 'alert-warning-style'}">
            <i data-lucide="${alert.icon}" class="alert-icon ${alert.type === 'danger' ? 'alert-icon-danger' : 'alert-icon-warning'}"></i>
            <div><p class="alert-text-title">${alert.title}</p><p class="alert-text-msg">${alert.msg}</p></div>
        </div>
    `).join('');

    // Input Líquido (Process Flow)
    const unitLabel = state.processUnit;
    document.getElementById('liquidInputContainer').innerHTML = `
        <div class="liquid-input-card">
            <div class="liquid-input-header">
                <span class="liquid-input-title">VAZÃO DE PROCESSO</span>
                <div class="unit-toggle">
                    <button onclick="toggleUnit('hL')" class="${state.processUnit === 'hL' ? 'active' : 'inactive'}">hL</button>
                    <button onclick="toggleUnit('m3')" class="${state.processUnit === 'm3' ? 'active' : 'inactive'}">m³</button>
                </div>
            </div>
            <div class="liquid-input-grid">
                <div class="input-group"><div class="input-label"><span>Inicial (${unitLabel})</span></div><input type="number" step="0.01" value="${getDisplayVolumeValue(metrics.liquid.displayStartHl)}" onchange="updateProcessStart(this.value)"></div>
                <div class="input-group"><div class="input-label"><span>Final (${unitLabel})</span></div><input type="number" step="0.01" value="${getDisplayVolumeValue(metrics.liquid.displayEndHl)}" onchange="updateProcessEnd(this.value)"></div>
            </div>
            <div class="liquid-input-footer">
                <div class="liquid-input-footer-text">
                     <div class="footer-row"><span class="footer-label">Medido</span><span class="footer-value-measured">${formatVolume(metrics.liquid.measuredFlowHl)}</span></div>
                     <div class="footer-row"><span class="footer-label">Perda</span><span class="footer-value-loss">-${formatVolume(metrics.liquid.processLossHl)}</span></div>
                </div>
            </div>
        </div>`;

    // Render Stages
    document.getElementById('stagesContainer').innerHTML = metrics.flow.map(stage => {
        const badgeClass = stage.type === 'process' ? 'badge-process' : 'badge-quality';
        const typeLabel = stage.type === 'process' ? 'Processo' : 'Qualidade';
        const manualClass = stage.isManual ? 'is-manual' : '';
        
        // Conversão para exibição (somente visual)
        const displayIn = toDisplayUnit(stage.in, stage.conversion);
        // Opcional: Converter OK também para a unidade, ou manter garrafas? Geralmente produção OK se vê na unidade de saída da máquina.
        const displayOk = toDisplayUnit(stage.ok, stage.conversion); 
        
        const unitLabel = stage.inputUnit ? stage.inputUnit : 'Garrafas';
        const rejectLabel = stage.rejectLabel ? stage.rejectLabel : 'Rejeito (Out)';

        return `
        <div class="stage-card">
            <div class="stage-card-header">
                <span class="stage-title" title="${stage.label}">${stage.label}</span>
                <span class="stage-badge ${badgeClass}">${typeLabel}</span>
            </div>
            <div class="stage-grid">
                <!-- Coluna IN (Azul) -->
                <div class="stage-input-group">
                    <label class="label-in">Entrada (${unitLabel})</label>
                    <input type="number" value="${displayIn}" 
                        onchange="updateStageInput('${stage.id}', this.value, ${stage.conversion || 1})" 
                        class="stage-input-in ${manualClass}">
                </div>
                <!-- Coluna OUT (Vermelho) -->
                <div class="stage-input-group">
                    <label class="label-out" title="${rejectLabel}">${rejectLabel}</label>
                    <input type="number" value="${stage.rejects}" 
                        onchange="updateReject('${stage.id}', this.value)" 
                        class="stage-input-out">
                </div>
                <!-- Coluna OK (Verde) - Read Only -->
                <div class="stage-input-group">
                    <label class="label-ok">Produzido (Ok)</label>
                    <input type="number" value="${displayOk}" readonly class="stage-input-ok">
                </div>
            </div>
            <div class="stage-footer">
                <span class="stage-footer-out-label">Perda Financeira:</span>
                <span class="stage-loss-money">-${formatCurrency(stage.financialLoss)}</span>
            </div>
        </div>
    `}).join('');

    // Chart
    const chartHTML = metrics.flow.map(item => {
        const pct = metrics.financial.total > 0 ? (item.financialLoss / metrics.financial.total) : 0;
        if (pct < 0.001) return '';
        return `
        <div>
            <div class="chart-bar-container"><span class="chart-bar-label">${item.label}</span><span class="chart-bar-value">${formatCurrency(item.financialLoss)}</span></div>
            <div class="chart-bar-bg"><div class="chart-bar ${item.id === 'wrapper' ? 'chart-bar-process' : 'chart-bar-material'}" style="width: ${(pct * 100)}%"></div></div>
        </div>`
    }).join('');
    // Adicionar barra de processo se houver
    const procPct = metrics.financial.total > 0 ? (metrics.liquid.processLossMoney / metrics.financial.total) : 0;
    const procChart = procPct > 0.001 ? `<div><div class="chart-bar-container"><span class="chart-bar-label">0. Perda Proc. (Líquido)</span><span class="chart-bar-value">${formatCurrency(metrics.liquid.processLossMoney)}</span></div><div class="chart-bar-bg"><div class="chart-bar chart-bar-process" style="width: ${(procPct * 100)}%"></div></div></div>` : '';
    
    document.getElementById('lossBreakdown').innerHTML = procChart + chartHTML;
    
    // SKU Details List
    const bottle = BOTTLE_TYPES[state.currentSku];
    document.getElementById('skuDetails').innerHTML = `
        <li><span>SKU</span> <strong>${bottle.label}</strong></li>
        <li><span>Volume</span> <strong>${bottle.volumeHl} hL</strong></li>
        <li><span>Tam. Palete</span> <strong>${bottle.palletSize} un</strong></li>
    `;

    document.getElementById('operationalImpact').innerText = formatCurrency(metrics.financial.total);
    lucide.createIcons();
}

// --- 4. ACTIONS ---
window.toggleUnit = (u) => { state.processUnit = u; render(); };
// Agora updateStageInput recebe o fator de conversão
window.updateStageInput = (id, val, conversion) => { 
    const num = parseFloat(val); 
    if (!isNaN(num)) { 
        // Armazena SEMPRE em garrafas no state
        state.manualInputs[id] = Math.round(num * conversion); 
        render(); 
    } 
};
window.updateReject = (id, val) => { state.rejects[id] = Math.max(0, parseInt(val) || 0); render(); };
window.updateProcessStart = (val) => { const n = parseFloat(val); if (!isNaN(n)) { state.processFlowStart = state.processUnit === 'm3' ? n * 10 : n; if(!state.processFlowEnd) state.processFlowEnd = state.processFlowStart; render(); }};
window.updateProcessEnd = (val) => { const n = parseFloat(val); if (!isNaN(n)) { state.processFlowEnd = state.processUnit === 'm3' ? n * 10 : n; render(); }};

window.resetInputs = () => {
    const keys = Object.keys(state.manualInputs);
    keys.forEach(k => state.manualInputs[k] = 0);
    keys.forEach(k => state.rejects[k] = 0);
    state.processFlowStart = 0; state.processFlowEnd = 0;
    render();
};

window.applyDemo = () => {
    state.manualInputs = { ...demoPresets.manualInputs };
    state.rejects = { ...demoPresets.rejects };
    state.processFlowStart = demoPresets.processFlowStart;
    state.processFlowEnd = demoPresets.processFlowEnd;
    state.runMode = 'mixed';
    render();
};

window.toggleManualOnly = (checked) => { state.runMode = checked ? 'manual' : 'mixed'; render(); };

// Settings Modal Logic (Same as before)
const modal = document.getElementById('settingsModal');
document.getElementById('btnSettings').onclick = () => {
    document.getElementById('costInputsContainer').innerHTML = Object.entries(state.costs).map(([k, v]) => `
        <div class="cost-input-group"><label>${k}</label><div class="cost-input-wrapper"><span class="cost-input-currency">$</span><input type="number" step="0.01" id="cost_${k}" value="${v}" class="cost-input-field"></div></div>`).join('');
    modal.classList.remove('hidden');
};
document.getElementById('btnCloseSettings').onclick = () => modal.classList.add('hidden');
document.getElementById('btnSaveSettings').onclick = () => { Object.keys(state.costs).forEach(k => { const el = document.getElementById(`cost_${k}`); if(el) state.costs[k] = parseFloat(el.value); }); modal.classList.add('hidden'); render(); };
document.getElementById('skuSelect').onchange = (e) => { state.currentSku = e.target.value; state.processFlowEnd = 0; render(); };

lucide.createIcons();
render();
