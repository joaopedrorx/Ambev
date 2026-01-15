// --- ARQUIVO JS (Lógica do Sistema) ---
// Todo o script foi movido de index2.html para aqui.

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

// Carregar Tema Salvo
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
        palletizer: 0
    },

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
        palletizer: 0
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

// Run mode: 'mixed' uses measured flow + manual rejects; 'manual' uses only manual inputs (no process loss)
state.runMode = 'mixed';

// Demo presets (applied when user clicks DEMONSTRAÇÃO)
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
        palletizer: 1199160
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
        palletizer: 0
    },
    processFlowStart: 12500.00,
    processFlowEnd: 16550.00,
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

// --- 2. ENGINE DE CÁLCULO ---
function calculateMetrics() {
    const bottle = BOTTLE_TYPES[state.currentSku];
    const c = state.costs;

    const costLiquid = bottle.volumeHl * c.liquidHl;
    const costLabels = c.labelFront + c.labelBack + c.labelNeck;
    const costSixPack = c.sixPackCard / 6;
    const costShrink = c.shrinkFilm / 24;

    const stagesDef = [
        { id: 'depalletizer', label: '1. Despaletizadora', type: 'process', lossValue: c.glass },
        { id: 'ebi', label: '2. Inspetor Vazias', type: 'quality', lossValue: c.glass },
        { id: 'filler', label: '3. Envasadora', type: 'process', lossValue: c.glass + costLiquid + c.crown },
        { id: 'fbi', label: '4. Inspetor Cheias', type: 'quality', lossValue: c.glass + costLiquid + c.crown },
        { id: 'labeler', label: '5. Rotuladora', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels },
        { id: 'labelInspector', label: '6. Inspetor Rótulo', type: 'quality', lossValue: c.glass + costLiquid + c.crown + costLabels },
        { id: 'packer1', label: '7. Empacotadora 1 (Cesta)', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels + costSixPack },
        { id: 'packer2', label: '8. Empacotadora 2 (Shrink)', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels + costSixPack + costShrink },
        { id: 'palletizer', label: '9. Paletização', type: 'process', lossValue: c.glass + costLiquid + c.crown + costLabels + costSixPack + costShrink }
    ];

    let currentVolume = state.manualInputs['depalletizer'] || 0;
    const initialVolume = currentVolume;

    let totalFinancialLoss = 0;
    let totalVolumeLostHl = 0;
    let flowData = [];
    let fillerInputCount = 0;

    stagesDef.forEach((stage, index) => {
        let stageInput = currentVolume;

        if (index > 0 && state.manualInputs[stage.id] !== undefined) {
            stageInput = state.manualInputs[stage.id];
        }

        if (stage.id === 'filler') {
            fillerInputCount = stageInput;
        }

        const rejectCount = state.rejects[stage.id] || 0;

        const stepLoss = rejectCount * stage.lossValue;
        totalFinancialLoss += stepLoss;

        const hasLiquid = ['filler', 'fbi', 'labeler', 'labelInspector', 'packer1', 'packer2', 'palletizer'].includes(stage.id);
        if (hasLiquid) {
            totalVolumeLostHl += rejectCount * bottle.volumeHl;
        }

        flowData.push({
            ...stage,
            in: stageInput,
            rejects: rejectCount,
            financialLoss: stepLoss,
            out: stageInput - rejectCount,
            isManual: state.manualInputs[stage.id] !== undefined
        });

        currentVolume = stageInput - rejectCount;
    });

    // --- LÓGICA DE VAZÃO ---
    const theoreticalLiquidNeededHl = fillerInputCount * bottle.volumeHl;
    let measuredFlowHl = 0;
    let displayStartHl = state.processFlowStart;
    let displayEndHl = state.processFlowEnd;

    if (state.runMode === 'manual') {
        // Use theoretical only, ignore measured flow (run with manual inputs only)
        measuredFlowHl = theoreticalLiquidNeededHl;
        displayEndHl = displayStartHl + measuredFlowHl;
    } else {
        if (state.processFlowEnd === null) {
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

    // --- DETECÇÃO DE ANOMALIAS (ALERTAS) ---
    const alerts = [];

    if (flowData[1].in > flowData[0].out) {
        const diff = flowData[1].in - flowData[0].out;
        alerts.push({
            type: 'warning',
            title: 'Retorno de Garrafas Detectado (Re-loop)',
            msg: `Entrada no EBI (${formatNumber(flowData[1].in)}) é maior que a saída da Despaletizadora (${formatNumber(flowData[0].out)}). Diferença: +${formatNumber(diff)} un.`,
            icon: 'refresh-ccw'
        });
    }

    if (flowData[2].in > flowData[1].out) {
        const diff = flowData[2].in - flowData[1].out;
        alerts.push({
            type: 'danger',
            title: 'QUEBRA DE PADRÃO DE QUALIDADE',
            msg: `Envasadora processando ${formatNumber(flowData[2].in)} garrafas, mas EBI aprovou apenas ${formatNumber(flowData[1].out)}. Risco de ${formatNumber(diff)} garrafas não inspecionadas!`,
            icon: 'alert-octagon'
        });
    }

    return {
        flow: flowData,
        financial: { total: totalFinancialLoss },
        liquid: {
            totalHl: totalVolumeLostHl,
            processLossHl: processLossHl,
            bottleLossHl: totalVolumeLostHl - processLossHl,
            processLossMoney: processLossMoney,
            measuredFlowHl: measuredFlowHl,
            displayStartHl: displayStartHl,
            displayEndHl: displayEndHl,
            theoreticalNeeded: theoreticalLiquidNeededHl
        },
        production: { bottles: finalProduction, pallets: pallets },
        efficiency: efficiency,
        alerts: alerts // Novo campo
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

const getDisplayVolumeValue = (valHl) => {
    const isM3 = state.processUnit === 'm3';
    return isM3 ? (valHl / 10).toFixed(2) : valHl.toFixed(2);
};

function render() {
    const metrics = calculateMetrics();

    // RENDERIZAR ALERTAS
    const alertsContainer = document.getElementById('alertsContainer');
    alertsContainer.innerHTML = '';

    if (metrics.alerts.length > 0) {
        metrics.alerts.forEach(alert => {
            const isDanger = alert.type === 'danger';
            const alertClass = isDanger ? 'alert-danger-style' : 'alert-warning-style';
            const iconClass = isDanger ? 'alert-icon-danger' : 'alert-icon-warning';

            const alertHtml = `
                <div class="${alertClass}" role="alert">
                    <i data-lucide="${alert.icon}" class="alert-icon ${iconClass}"></i>
                    <div>
                        <p class="alert-text-title">${alert.title}</p>
                        <p class="alert-text-msg">${alert.msg}</p>
                    </div>
                </div>
            `;
            alertsContainer.innerHTML += alertHtml;
        });
        lucide.createIcons();
    }

    // KPIs
    document.getElementById('kpiProduction').innerText = `${formatNumber(metrics.production.bottles)} un`;
    document.getElementById('kpiPallets').innerText = `${metrics.production.pallets.toFixed(1)} Paletes`;

    const effElem = document.getElementById('kpiEfficiency');
    effElem.innerText = `${metrics.efficiency.toFixed(2)}%`;
    effElem.className = `kpi-value ${metrics.efficiency > 90 ? 'kpi-eff-high' : 'kpi-eff-low'}`;

    document.getElementById('kpiIPE').innerText = metrics.liquid.totalHl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' hL';
    document.getElementById('kpiIPEDetails').innerText = `Proc: ${metrics.liquid.processLossHl.toFixed(2)} + Garrafa: ${metrics.liquid.bottleLossHl.toFixed(2)}`;

    document.getElementById('kpiIPOW').innerText = formatCurrency(metrics.financial.total);
    document.getElementById('chartTotalLoss').innerText = formatCurrency(metrics.financial.total);

    // SKU Details
    const bottle = BOTTLE_TYPES[state.currentSku];
    document.getElementById('skuDetails').innerHTML = `
        <li><span>SKU</span> <strong>${bottle.label}</strong></li>
        <li><span>Volume</span> <strong>${bottle.volumeHl} hL</strong></li>
        <li><span>Tam. Palete</span> <strong>${bottle.palletSize} un</strong></li>
    `;

    // --- RENDERIZAR INPUT DE FLUIDOS ---
    const unitLabel = state.processUnit;
    const displayStart = getDisplayVolumeValue(metrics.liquid.displayStartHl);
    const displayEnd = getDisplayVolumeValue(metrics.liquid.displayEndHl);

    const liquidInputHTML = `
        <div class="liquid-input-card">
            <div class="liquid-input-header">
                <span class="liquid-input-title">VAZÃO DE PROCESSO</span>
                <div class="unit-toggle">
                    <button onclick="toggleUnit('hL')" class="${state.processUnit === 'hL' ? 'active' : 'inactive'}">hL</button>
                    <button onclick="toggleUnit('m3')" class="${state.processUnit === 'm3' ? 'active' : 'inactive'}">m³</button>
                </div>
            </div>
            
            <div class="liquid-input-grid">
                <div class="input-group">
                    <div class="input-label">
                        <span>Inicial (${unitLabel})</span>
                    </div>
                    <input type="number" step="0.01" value="${displayStart}" onchange="updateProcessStart(this.value)">
                </div>
                <div class="input-group">
                    <div class="input-label">
                        <span>Final (${unitLabel})</span>
                    </div>
                    <input type="number" step="0.01" value="${displayEnd}" onchange="updateProcessEnd(this.value)">
                </div>
            </div>
            
            <div class="liquid-input-footer">
                <div class="liquid-input-footer-text">
                     <div class="footer-row">
                        <span class="footer-label">Medido (Delta)</span>
                        <span class="footer-value-measured">${formatVolume(metrics.liquid.measuredFlowHl)}</span>
                     </div>
                     <div class="footer-row">
                        <span class="footer-label">Perda Processo</span>
                        <span class="footer-value-loss">-${formatVolume(metrics.liquid.processLossHl)}</span>
                     </div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('liquidInputContainer').innerHTML = liquidInputHTML;

    // Stages Inputs
    let stagesHTML = metrics.flow.map(stage => {
        const badgeClass = stage.type === 'process' ? 'badge-process' : 'badge-quality';
        const typeLabel = stage.type === 'process' ? 'Processo' : 'Qualidade';
        const manualClass = stage.isManual ? 'is-manual' : '';

        return `
        <div class="stage-card">
            <div class="stage-card-header">
                <span class="stage-title" title="${stage.label}">${stage.label}</span>
                <span class="stage-badge ${badgeClass}">${typeLabel}</span>
            </div>
            <div class="stage-grid">
                <div class="stage-input-group">
                    <div class="input-label stage-input-label-in">
                        <span>Entrada (In)</span>
                    </div>
                    <input type="number" value="${stage.in}" onchange="updateStageInput('${stage.id}', this.value)" class="stage-input-in ${manualClass}">
                </div>
                <div class="stage-input-group">
                    <div class="input-label stage-input-label-out">
                        <span>Rejeito (Out)</span>
                    </div>
                    <input type="number" value="${stage.rejects}" onchange="updateReject('${stage.id}', this.value)" class="stage-input-out">
                </div>
            </div>
            <div class="stage-footer">
                <span class="stage-footer-out-label">Saída teórica: <strong>${formatNumber(stage.out)}</strong></span>
                <span class="stage-footer-loss">-${formatCurrency(stage.financialLoss)}</span>
            </div>
        </div>
    `}).join('');

    document.getElementById('stagesContainer').innerHTML = stagesHTML;

    // Chart
    let chartData = [];
    if (metrics.liquid.processLossMoney > 0.01) {
        chartData.push({ label: '0. Perda Proc. (Líquido)', financialLoss: metrics.liquid.processLossMoney, colorClass: 'chart-bar-process' });
    }
    metrics.flow.forEach(item => {
        chartData.push({ label: item.label, financialLoss: item.financialLoss, colorClass: 'chart-bar-material' });
    });

    const chartHTML = chartData.map((item) => {
        const pct = metrics.financial.total > 0 ? (item.financialLoss / metrics.financial.total) : 0;
        if (pct < 0.001) return '';
        return `
        <div>
            <div class="chart-bar-container">
                <span class="chart-bar-label">${item.label}</span>
                <span class="chart-bar-value">${formatCurrency(item.financialLoss)}</span>
            </div>
            <div class="chart-bar-bg">
                <div class="chart-bar ${item.colorClass}" style="width: ${(pct * 100)}%"></div>
            </div>
        </div>
    `}).join('');
    document.getElementById('lossBreakdown').innerHTML = chartHTML || '<div class="text-center text-gray-400 text-xs py-10">Nenhuma perda registrada</div>';

    document.getElementById('operationalImpact').innerText = formatCurrency(metrics.financial.total);

    lucide.createIcons();
}

// --- 4. ACTIONS ---
window.toggleUnit = (unit) => { state.processUnit = unit; render(); };
window.updateStageInput = (stageId, val) => { const num = parseInt(val); if (!isNaN(num)) { state.manualInputs[stageId] = num; render(); } };
window.updateReject = (stageId, val) => { state.rejects[stageId] = Math.max(0, parseInt(val) || 0); render(); };
window.updateProcessStart = (val) => { const num = parseFloat(val); if (!isNaN(num)) { const valInHl = state.processUnit === 'm3' ? num * 10 : num; state.processFlowStart = valInHl; if (state.processFlowEnd === null) state.processFlowEnd = valInHl; render(); } };
window.updateProcessEnd = (val) => { const num = parseFloat(val); if (!isNaN(num)) { const valInHl = state.processUnit === 'm3' ? num * 10 : num; state.processFlowEnd = valInHl; render(); } };
// Função de Reset atualizada para os dados reais
window.resetInputs = () => {
    state.manualInputs = {
        depalletizer: 0,
        ebi: 0,
        filler: 0,
        fbi: 0,
        labeler: 0,
        labelInspector: 0,
        packer1: 0,
        packer2: 0,
        palletizer: 0
    };
    state.rejects = {
        depalletizer: 0,
        ebi: 0,
        filler: 0,
        fbi: 0,
        labeler: 0,
        labelInspector: 0,
        packer1: 0,
        packer2: 0,
        palletizer: 0
    };
    state.processFlowStart = 0;
    state.processFlowEnd = 0;
    render();
};

// Aplica os presets de demonstração
window.applyDemo = () => {
    state.manualInputs = { ...demoPresets.manualInputs };
    state.rejects = { ...demoPresets.rejects };
    state.processFlowStart = demoPresets.processFlowStart;
    state.processFlowEnd = demoPresets.processFlowEnd;
    state.costs = { ...demoPresets.costs };
    // desliga modo 'somente manuais' se ligado
    state.runMode = 'mixed';
    const chk = document.getElementById('chkManualOnly'); if (chk) chk.checked = false;
    render();
};

// Alterna modo manual-only
window.toggleManualOnly = (checked) => {
    state.runMode = checked ? 'manual' : 'mixed';
    render();
};

// Modal Logic
const modal = document.getElementById('settingsModal');
const btnSettings = document.getElementById('btnSettings');
const btnClose = document.getElementById('btnCloseSettings');
const btnSave = document.getElementById('btnSaveSettings');

btnSettings.onclick = () => {
    const container = document.getElementById('costInputsContainer');
    container.innerHTML = Object.entries(state.costs).map(([key, val]) => `
        <div class="cost-input-group">
            <label>${key}</label>
            <div class="cost-input-wrapper">
                <span class="cost-input-currency">$</span>
                <input type="number" step="0.01" id="cost_${key}" value="${val}" class="cost-input-field">
            </div>
        </div>
    `).join('');
    modal.classList.remove('hidden');
};
btnClose.onclick = () => modal.classList.add('hidden');
btnSave.onclick = () => { Object.keys(state.costs).forEach(key => { const input = document.getElementById(`cost_${key}`); if (input) state.costs[key] = parseFloat(input.value) || 0; }); modal.classList.add('hidden'); render(); };
document.getElementById('skuSelect').onchange = (e) => { state.currentSku = e.target.value; state.processFlowEnd = null; render(); };

lucide.createIcons();
// Inicializa tema antes de renderizar
const icon = document.getElementById('themeIcon');
if (document.documentElement.classList.contains('dark')) {
    if (icon) icon.setAttribute('data-lucide', 'sun');
} else {
    if (icon) icon.setAttribute('data-lucide', 'moon');
}
render();