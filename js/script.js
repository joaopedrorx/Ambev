// --- ARQUIVO JS (Refinado: Orçamento vs Realizado e Custos de Insumos) ---

// --- 0. SERVIÇO DE PERSISTÊNCIA ---
const StorageService = {
    KEY: 'ambev_sim_products_v5_budget', // Versão atualizada

    // Base de dados inicial
    getDefaultProducts: () => ({
        'LATA350': {
            id: 'LATA350',
            label: 'Lata 350ml',
            brand: 'Brahma',
            type: 'can',
            volumeHl: 0.00350,
            palletSize: 3800,
            costs: {
                liquidHl: 45.00,
                base_material: 0.15, // Corpo
                closure: 0.03,       // Tampa
                label_set: 0.00,     // Litografia
                cardboard: 0.00,
                shrink_film: 0.15,   // Filme Fardo
                stretch_film: 8.50   // Filme Palete
            },
            targets: {
                efficiency: 95.0,
                maxIPOWPct: 1.0,
                maxIPEPct: 0.5,
                budgetCostPerHl: 120.00 // Meta de Custo ($/hL)
            }
        },
        'LN330': {
            id: 'LN330',
            label: 'Longneck 330ml',
            brand: 'Stella Artois',
            type: 'glass',
            volumeHl: 0.00330,
            palletSize: 2016,
            costs: {
                liquidHl: 60.00,
                base_material: 0.50,
                closure: 0.05,
                label_set: 0.15,
                cardboard: 0.40,     // Cesta Papelão
                shrink_film: 0.00,   // Caixa (sem shrink)
                stretch_film: 10.00
            },
            targets: {
                efficiency: 90.0,
                maxIPOWPct: 1.5,
                maxIPEPct: 0.8,
                budgetCostPerHl: 250.00
            }
        },
        'PET2L': {
            id: 'PET2L',
            label: 'Garrafa PET 2 Litros',
            brand: 'Guaraná Antarctica',
            type: 'pet',
            volumeHl: 0.02000,
            palletSize: 360,
            costs: {
                liquidHl: 35.00,
                base_material: 0.40, // Preforma
                closure: 0.08,
                label_set: 0.12,
                cardboard: 0.00,
                shrink_film: 0.35,
                stretch_film: 9.00
            },
            targets: {
                efficiency: 93.0,
                maxIPOWPct: 1.1,
                maxIPEPct: 0.4,
                budgetCostPerHl: 85.00
            }
        }
    }),

    loadProducts: function () {
        const stored = localStorage.getItem(this.KEY);
        if (stored) {
            return JSON.parse(stored);
        }
        const defaults = this.getDefaultProducts();
        this.saveProducts(defaults);
        return defaults;
    },

    saveProducts: function (products) {
        localStorage.setItem(this.KEY, JSON.stringify(products));
    }
};

// --- 1. ESTADO GLOBAL ---
const state = {
    products: StorageService.loadProducts(),
    currentSku: 'LN330',

    manualInputs: {
        depalletizer: 0, ebi: 0, filler: 0, fbi: 0, rot1: 0, rot2: 0, fbi1: 0, fbi2: 0,
        packer1: 0, packer2: 0, palletizer: 0, wrapper: 0
    },
    processFlowStart: 0,
    processFlowEnd: 0,
    processUnit: 'hL',
    runMode: 'mixed',

    rejects: {
        depalletizer: 0, ebi: 0, filler: 0, fbi: 0, rot1: 0, rot2: 0, fbi1: 0, fbi2: 0,
        packer1: 0, packer2: 0, palletizer: 0, wrapper: 0
    },
    withdrawals: {
        depalletizer: 0, ebi: 0, filler: 0, fbi: 0, rot1: 0, rot2: 0, fbi1: 0, fbi2: 0,
        packer1: 0, packer2: 0, palletizer: 0, wrapper: 0
    },
    lossDisplayMode: 'money' // 'money' ou 'percent'
};

// --- 2. ENGINE DE CÁLCULO ---
function calculateMetrics() {
    const product = state.products[state.currentSku];
    if (!product) return null;

    const c = product.costs;
    const t = product.targets;

    // --- CUSTOS UNITÁRIOS DOS INSUMOS ---
    const costLiquidPerUnit = product.volumeHl * c.liquidHl;
    const costCardboardPerUnit = c.cardboard > 0 ? (c.cardboard / 6) : 0;
    const costShrinkPerUnit = c.shrink_film > 0 ? (c.shrink_film / 24) : 0;
    const costStretchPerUnit = c.stretch_film > 0 ? (c.stretch_film / product.palletSize) : 0;

    // --- CASCADING COSTS (Valor Agregado para IPOW) ---
    // Valor acumulado que vai para o lixo se quebrar naquela etapa
    const val_stage1 = c.base_material;
    const val_stage2 = val_stage1 + costLiquidPerUnit + c.closure;
    const val_stage3 = val_stage2 + c.label_set;
    const val_stage4 = val_stage3 + costCardboardPerUnit;
    const val_stage5 = val_stage4 + costShrinkPerUnit;
    const val_stage6 = val_stage5 + costStretchPerUnit;

    const totalUnitCostTheoretical = val_stage6;

    // --- DEFINIÇÃO DOS ESTÁGIOS E CONSUMO DE INSUMOS ---
    // 'consumptionCost': Custo unitário do que é ADICIONADO nesta etapa (para cálculo orçamentário)
    const stagesDef = [
        // ORDEM REAL DE FLUXO NA LINHA
        { id: 'depalletizer', label: 'Despaletizadora (DPL)', type: 'process', lossValue: val_stage1, consumptionCost: c.base_material },
        { id: 'ebi', label: 'Inspt Vz (EBI)', type: 'quality', lossValue: val_stage1, consumptionCost: 0 },

        { id: 'filler', label: 'Enchedora (ECH)', type: 'process', lossValue: val_stage2, rejectLabel: 'Retirada PTP', consumptionCost: costLiquidPerUnit + c.closure },
        { id: 'fbi', label: 'Inspt Ch (Heuft ECH)', type: 'quality', lossValue: val_stage2, consumptionCost: 0 },

        { id: 'rot1', label: 'Rotuladora 1 (ROT1)', type: 'process', lossValue: val_stage3, consumptionCost: c.label_set },
        { id: 'fbi1', label: 'Inspt ROT1 (Checkmat.1)', type: 'quality', lossValue: val_stage3, consumptionCost: 0 },

        { id: 'rot2', label: 'Rotuladora 2 (ROT2)', type: 'process', lossValue: val_stage3, consumptionCost: c.label_set },
        { id: 'fbi2', label: 'Inspt ROT2 (Checkmat.2)', type: 'quality', lossValue: val_stage3, consumptionCost: 0 },

        { id: 'packer1', label: 'Empacotadora 1 (EPC1)', type: 'process', lossValue: val_stage4, multiplier: 6, consumptionCost: costCardboardPerUnit },
        { id: 'packer2', label: 'Empacotadora 2 (EPC2)', type: 'process', lossValue: val_stage5, multiplier: 24, consumptionCost: costShrinkPerUnit },
        { id: 'palletizer', label: 'Paletizadora (PAL)', type: 'process', lossValue: val_stage5, multiplier: 24, consumptionCost: 0 },
        { id: 'wrapper', label: 'Envolvedora (ENV)', type: 'process', lossValue: val_stage6, multiplier: 2016, consumptionCost: costStretchPerUnit }
    ];

    let currentVolume = state.manualInputs['depalletizer'] || 0;
    const initialVolume = currentVolume;

    let totalFinancialLoss = 0; // IPOW
    let totalVolumeLostHl = 0; // IPE
    let totalConsumedCost = 0; // Custo Real de Produção (Gastos totais)
    let flowData = [];
    let fillerInputCount = 0;

    stagesDef.forEach((stage, index) => {
        let stageInput = currentVolume;

        if (index > 0 && state.manualInputs[stage.id] !== undefined) {
            stageInput = state.manualInputs[stage.id];
            // O valor em manualInputs já está em garrafas (multiplicado em updateStageInput)
        }

        if (stage.id === 'filler') fillerInputCount = stageInput;

        const rejectCount = state.rejects[stage.id] || 0;
        const withdrawalCount = state.withdrawals[stage.id] || 0;

        // IPOW: Perda = Rejeitos * Valor Agregado até o momento
        const stepLoss = rejectCount * stage.lossValue;
        totalFinancialLoss += stepLoss;

        // Custo Real de Produção (Budget vs Real):
        // Custo = Tudo que entrou na máquina * Custo do Insumo adicionado nela
        // (Independente se virou rejeito ou produto bom, o insumo foi gasto)
        if (stage.consumptionCost > 0) {
            totalConsumedCost += stageInput * stage.consumptionCost;
        }

        // IPE: Perda Líquida (apenas rejeitos, não retiradas)
        const stageIndex = stagesDef.findIndex(s => s.id === stage.id);
        const fillerIndex = stagesDef.findIndex(s => s.id === 'filler');
        if (stageIndex >= fillerIndex) {
            totalVolumeLostHl += rejectCount * product.volumeHl;
        }

        const producedOk = stageInput - rejectCount - withdrawalCount;

        flowData.push({
            ...stage,
            in: stageInput,
            rejects: rejectCount,
            withdrawals: withdrawalCount,
            ok: producedOk,
            financialLoss: stepLoss,
            out: producedOk,
            isManual: state.manualInputs[stage.id] !== undefined
        });

        currentVolume = producedOk;
    });

    // --- CÁLCULO DE VAZÃO (IPE EXTRA) ---
    const theoreticalLiquidNeededHl = fillerInputCount * product.volumeHl;
    let measuredFlowHl = 0;
    let displayStartHl = state.processFlowStart;
    let displayEndHl = state.processFlowEnd;

    if (state.runMode === 'manual') {
        measuredFlowHl = theoreticalLiquidNeededHl;
        displayEndHl = displayStartHl + measuredFlowHl;
    } else {
        if (state.processFlowEnd === null || state.processFlowEnd === 0) {
            measuredFlowHl = theoreticalLiquidNeededHl * 1.015;
            displayEndHl = displayStartHl + measuredFlowHl;
        } else {
            measuredFlowHl = Math.max(0, state.processFlowEnd - state.processFlowStart);
            displayEndHl = state.processFlowEnd;
        }
    }

    const processLossHl = Math.max(0, measuredFlowHl - theoreticalLiquidNeededHl);
    // Somar custo do líquido perdido no processo ao Custo Total Consumido
    if (processLossHl > 0) {
        const processLossVal = processLossHl * c.liquidHl;
        const processLossMoney = processLossVal; // Para IPOW gráfico
        totalVolumeLostHl += processLossHl;
        totalFinancialLoss += processLossMoney; // IPE entra no IPOW? Geralmente sim.
        totalConsumedCost += processLossMoney; // Também entra no custo total gasto
    }

    const finalProduction = currentVolume;
    const finalProductionHl = finalProduction * product.volumeHl;
    const pallets = finalProduction / product.palletSize;

    // --- CÁLCULO DE ÍNDICES E BUDGET ---

    // 1. Custo Real por hL (Realizado)
    // Se não produziu nada, evita divisão por zero
    const actualCostPerHl = finalProductionHl > 0 ? (totalConsumedCost / finalProductionHl) : 0;

    // 2. Desvio Financeiro (Budget Impact)
    // (Custo Real Unitário - Custo Orçado Unitário) * Volume Produzido
    const budgetCostPerHl = t.budgetCostPerHl || 0;
    const budgetVariance = (actualCostPerHl - budgetCostPerHl);
    const totalBudgetImpact = budgetVariance * finalProductionHl;

    // Indices Percentuais
    const efficiency = initialVolume > 0 ? (finalProduction / initialVolume) * 100 : 0;

    const totalProcessedVolume = measuredFlowHl > 0 ? measuredFlowHl : theoreticalLiquidNeededHl;
    const ipePct = totalProcessedVolume > 0 ? (totalVolumeLostHl / totalProcessedVolume) * 100 : 0;

    const totalTheoreticalValue = initialVolume * totalUnitCostTheoretical;
    const ipowPct = totalTheoreticalValue > 0 ? (totalFinancialLoss / totalTheoreticalValue) * 100 : 0;

    const alerts = [];
    if (flowData[1].in > flowData[0].out) {
        const diff = flowData[1].in - flowData[0].out;
        alerts.push({ type: 'warning', title: 'Retorno de Linha', msg: `EBI (+${formatNumber(diff)}) > Despaletizadora.`, icon: 'refresh-ccw' });
    }
    if (flowData[2].in > flowData[1].out) {
        const diff = flowData[2].in - flowData[1].out;
        alerts.push({ type: 'danger', title: 'Quality Breach', msg: `Envasadora (+${formatNumber(diff)}) > EBI Aprovado.`, icon: 'alert-octagon' });
    }

    // Alertas de Retrabalho - Apenas para Empacotadoras (EPC1 e EPC2)
    // Estes processos DEVERIAM receber de múltiplos inspetores (FBI1 + FBI2)
    // ROT1/ROT2 têm entrada manual independente, não há retrabalho ali

    const packers = flowData.filter(s => ['packer1', 'packer2'].includes(s.id));
    packers.forEach(packer => {
        if (packer.isManual) {
            // Para EPC1/EPC2, buscar TODOS os inspetores que os alimentam
            // Especificamente: FBI1 (saída de ROT1) + FBI2 (saída de ROT2)
            const fbi1 = flowData.find(s => s.id === 'fbi1');
            const fbi2 = flowData.find(s => s.id === 'fbi2');

            let totalFromInspectors = 0;
            if (fbi1) totalFromInspectors += fbi1.out;
            if (fbi2) totalFromInspectors += fbi2.out;

            if (totalFromInspectors > 0) {
                const diff = packer.in - totalFromInspectors;
                if (diff > 10) {
                    const pctRework = ((diff / packer.in) * 100).toFixed(1);
                    alerts.push({
                        type: 'warning',
                        title: 'Retrabalho Detectado',
                        msg: `${packer.label} +${formatNumber(diff)} garrafas (${pctRework}% retrabalho).`,
                        icon: 'repeat-2'
                    });
                }
            }
        }
    });

    return {
        flow: flowData,
        financial: {
            totalLoss: totalFinancialLoss,
            totalConsumed: totalConsumedCost,
            actualCostPerHl: actualCostPerHl,
            budgetVariance: budgetVariance,
            totalBudgetImpact: totalBudgetImpact
        },
        liquid: {
            totalHl: totalVolumeLostHl, processLossHl,
            processLossMoney: processLossHl * c.liquidHl,
            measuredFlowHl, displayStartHl, displayEndHl
        },
        production: { bottles: finalProduction, pallets: pallets },
        indices: { efficiency, ipePct, ipowPct },
        targets: t,
        alerts: alerts
    };
}

// --- 3. HELPER FUNCTIONS ---
const formatCurrency = (val) => '$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatPercent = (val) => val.toFixed(2) + '%';
const formatNumber = (val) => val.toLocaleString('pt-BR');
const formatPct = (val) => val.toFixed(2) + '%';
const formatVolume = (valHl) => {
    const isM3 = state.processUnit === 'm3';
    const val = isM3 ? (valHl / 10) : valHl;
    const unit = isM3 ? 'm³' : 'hL';
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + unit;
};
const getDisplayVolumeValue = (valHl) => (state.processUnit === 'm3' ? valHl / 10 : valHl).toFixed(2);
const toDisplayUnit = (bottles, conversionFactor) => {
    if (!conversionFactor || conversionFactor === 1) return Math.round(bottles);
    return parseFloat((bottles / conversionFactor).toFixed(2));
};

// --- 4. UI RENDER ---
function render() {
    updateSkuSelector();

    const metrics = calculateMetrics();
    if (!metrics) return;

    const product = state.products[state.currentSku];
    const targets = metrics.targets;
    const idx = metrics.indices;
    const fin = metrics.financial;

    // --- KPIS ---
    document.getElementById('kpiProduction').innerText = `${formatNumber(metrics.production.bottles)} un`;
    document.getElementById('kpiPallets').innerText = `${metrics.production.pallets.toFixed(1)} Paletes`;

    const effElem = document.getElementById('kpiEfficiency');
    effElem.innerText = formatPct(idx.efficiency);
    effElem.className = `kpi-value ${idx.efficiency >= targets.efficiency ? 'kpi-eff-high' : 'kpi-eff-low'}`;
    document.querySelector('.kpi-efficiency-subtext').innerHTML = `Meta: <strong>${targets.efficiency}%</strong>`;

    const ipeElem = document.getElementById('kpiIPE');
    ipeElem.innerText = formatPct(idx.ipePct);
    ipeElem.style.color = idx.ipePct <= targets.maxIPEPct ? 'var(--color-green)' : 'var(--color-red)';
    document.getElementById('kpiIPEDetails').innerText = `Perda Líquida: ${metrics.liquid.totalHl.toFixed(2)} hL`;

    const ipowElem = document.getElementById('kpiIPOW');
    ipowElem.innerText = formatPct(idx.ipowPct);
    ipowElem.style.color = idx.ipowPct <= targets.maxIPOWPct ? 'var(--color-green)' : 'var(--color-red)';
    document.querySelector('.kpi-ipow-subtext').innerHTML = `Perda Total: <strong>${formatCurrency(fin.totalLoss)}</strong>`;

    document.getElementById('chartTotalLoss').innerText = formatCurrency(fin.totalLoss);

    // Atualizar label do botão de toggle de modo
    const lossModeLabel = document.getElementById('lossModeLabel');
    if (lossModeLabel) {
        lossModeLabel.innerText = state.lossDisplayMode === 'money' ? '$' : '%';
    }

    // --- CARD IMPACTO FINANCEIRO (Budget vs Real) ---
    // Recriando o HTML do card de impacto para mostrar os detalhes do orçamento
    const impactCard = document.querySelector('.impact-card');
    const varianceColor = fin.totalBudgetImpact > 0 ? 'text-red-400' : 'text-green-400';
    const varianceSign = fin.totalBudgetImpact > 0 ? '+' : '';

    impactCard.innerHTML = `
        <h3>Orçamento vs Realizado</h3>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.8rem; color:#ccc;">
            <span>Orçado:</span> <strong>${formatCurrency(targets.budgetCostPerHl)} /hL</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.8rem; color:#fff;">
            <span>Realizado:</span> <strong>${formatCurrency(fin.actualCostPerHl)} /hL</strong>
        </div>
        <div style="border-top:1px solid #555; padding-top:8px;">
            <p style="font-size:0.75rem; color:#999;">Impacto no Orçamento</p>
            <div id="operationalImpact" class="${varianceColor}" style="font-size:1.25rem;">
                ${varianceSign}${formatCurrency(fin.totalBudgetImpact)}
            </div>
        </div>
    `;

    // Gráficos e Alertas mantidos...
    const alertsContainer = document.getElementById('alertsContainer');
    alertsContainer.innerHTML = metrics.alerts.map(alert => `
        <div class="${alert.type === 'danger' ? 'alert-danger-style' : 'alert-warning-style'}">
            <i data-lucide="${alert.icon}" class="alert-icon ${alert.type === 'danger' ? 'alert-icon-danger' : 'alert-icon-warning'}"></i>
            <div><p class="alert-text-title">${alert.title}</p><p class="alert-text-msg">${alert.msg}</p></div>
        </div>
    `).join('');

    // Input Líquido
    const unitLabel = state.processUnit;
    document.getElementById('liquidInputContainer').innerHTML = `
        <div class="liquid-input-card">
            <div class="liquid-input-header">
                <span class="liquid-input-title">VAZÃO PROCESSO (${product.brand})</span>
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

    // Estágios - Renderizar em dois containers separados
    const renderStageCard = (stage) => {
        const badgeClass = stage.type === 'process' ? 'badge-process' : 'badge-quality';
        const typeLabel = stage.type === 'process' ? 'Processo' : 'Qualidade';
        const manualClass = stage.isManual ? 'is-manual' : '';

        // Determinar unidade de entrada baseada no multiplier
        let unitLabel = 'Garrafas';
        let unitShort = 'Un';
        if (stage.multiplier === 6) {
            unitLabel = 'Pacotes (6)';
            unitShort = 'Pac';
        } else if (stage.multiplier === 24) {
            unitLabel = 'Fardos (24)';
            unitShort = 'Frd';
        } else if (stage.multiplier === 2016) {
            unitLabel = 'Paletes (2016)';
            unitShort = 'Pal';
        }

        // Exibir input em unidade original (não multiplicado)
        const displayIn = stage.multiplier ? (stage.in / stage.multiplier).toFixed(1) : toDisplayUnit(stage.in, stage.conversion);
        const displayOk = stage.multiplier ? (stage.ok / stage.multiplier).toFixed(1) : toDisplayUnit(stage.ok, stage.conversion);
        const rejectLabel = stage.rejectLabel ? stage.rejectLabel : 'Rejeito';
        const physicalLoss = stage.rejects;

        // Calcular perda em porcentagem
        const stagePercentLoss = stage.in > 0 ? (stage.rejects / stage.in) * 100 : 0;
        const lossDisplay = state.lossDisplayMode === 'money'
            ? `-${formatCurrency(stage.financialLoss)}`
            : `-${formatPercent(stagePercentLoss)}`;

        // Renderizar campos de rejeito e retirada para pontos específicos
        const processesWithWithdrawal = ['filler', 'rot1', 'rot2', 'packer1', 'packer2'];
        let rejectAndOkFields = '';

        if (stage.type === 'quality') {
            // Pontos de inspeção: mostrar rejeitos
            rejectAndOkFields = `
                <div class="stage-input-group"><label class="label-out" title="${rejectLabel}">${rejectLabel}</label><input type="number" value="${stage.rejects}" onchange="updateReject('${stage.id}', this.value)" class="stage-input-out"></div>
                <div class="stage-input-group"><label class="label-ok">Produzido (Ok)</label><input type="number" value="${displayOk}" readonly class="stage-input-ok"></div>`;
        } else if (processesWithWithdrawal.includes(stage.id)) {
            // Pontos produtivos específicos: mostrar rejeitos E retiradas
            const displayWithdrawal = stage.multiplier ? (stage.withdrawals / stage.multiplier).toFixed(1) : stage.withdrawals;
            rejectAndOkFields = `
                <div class="stage-input-group"><label class="label-out" title="${rejectLabel}">${rejectLabel}</label><input type="number" value="${stage.rejects}" onchange="updateReject('${stage.id}', this.value)" class="stage-input-out"></div>
                <div class="stage-input-group"><label class="label-out" title="Retirada para análise">Retirada</label><input type="number" value="${displayWithdrawal}" onchange="updateWithdrawal('${stage.id}', this.value, ${stage.multiplier || 1})" class="stage-input-withdrawal"></div>
                <div class="stage-input-group"><label class="label-ok">Produzido (Ok)</label><input type="number" value="${displayOk}" readonly class="stage-input-ok"></div>`;
        } else {
            // Demais processos
            rejectAndOkFields = `
                <div class="stage-input-group"><label class="label-ok">Produzido (Ok)</label><input type="number" value="${displayOk}" readonly class="stage-input-ok"></div>`;
        }

        return `
        <div class="stage-card">
            <div class="stage-card-header">
                <span class="stage-title" title="${stage.label}">${stage.label}</span>
                <span class="stage-badge ${badgeClass}">${typeLabel}</span>
            </div>
            <div class="stage-grid">
                <div class="stage-input-group"><label class="label-in">Entrada (${unitLabel})</label><input type="number" value="${displayIn}" onchange="updateStageInput('${stage.id}', this.value, ${stage.multiplier || 1})" class="stage-input-in ${manualClass}"></div>
                ${rejectAndOkFields}
            </div>
            <div class="stage-footer">
                ${stage.type === 'quality' ? `<span class="stage-footer-phy-loss">Perda: <strong>${physicalLoss} ${unitShort}</strong></span>` : ''}
                <span class="stage-loss-money">${lossDisplay}</span>
            </div>
        </div>`;
    };

    // Renderizar todos os estágios em ordem cronológica (sem separação)
    document.getElementById('stagesContainer').innerHTML = metrics.flow.map(renderStageCard).join('');

    // Gráfico
    const chartHTML = metrics.flow.map(item => {
        const pct = metrics.financial.totalLoss > 0 ? (item.financialLoss / metrics.financial.totalLoss) : 0;
        if (pct < 0.001) return '';
        const stagePercentLoss = item.in > 0 ? (item.rejects / item.in) * 100 : 0;
        const valueDisplay = state.lossDisplayMode === 'money'
            ? formatCurrency(item.financialLoss)
            : formatPercent(stagePercentLoss);
        return `<div><div class="chart-bar-container"><span class="chart-bar-label">${item.label}</span><span class="chart-bar-value">${valueDisplay}</span></div><div class="chart-bar-bg"><div class="chart-bar ${item.id === 'wrapper' ? 'chart-bar-process' : 'chart-bar-material'}" style="width: ${(pct * 100)}%"></div></div></div>`
    }).join('');
    const procPct = metrics.financial.totalLoss > 0 ? (metrics.liquid.processLossMoney / metrics.financial.totalLoss) : 0;
    const procValueDisplay = state.lossDisplayMode === 'money'
        ? formatCurrency(metrics.liquid.processLossMoney)
        : formatPercent(procPct * 100);
    const procChart = procPct > 0.001 ? `<div><div class="chart-bar-container"><span class="chart-bar-label">0. Perda Proc. (Líquido)</span><span class="chart-bar-value">${procValueDisplay}</span></div><div class="chart-bar-bg"><div class="chart-bar chart-bar-process" style="width: ${(procPct * 100)}%"></div></div></div>` : '';
    document.getElementById('lossBreakdown').innerHTML = procChart + chartHTML;

    document.getElementById('skuDetails').innerHTML = `
        <li><span>SKU</span> <strong>${product.label}</strong></li>
        <li><span>Marca</span> <strong>${product.brand}</strong></li>
        <li><span>Tipo</span> <strong>${getTypeLabel(product.type)}</strong></li>
        <li><span>Volume</span> <strong>${product.volumeHl} hL</strong></li>
        <li><span>Tam. Palete</span> <strong>${product.palletSize} un</strong></li>
    `;

    lucide.createIcons();
}

// --- HELPERS E AÇÕES UI ---
function getTypeLabel(type) {
    const map = { 'glass': 'Vidro One Way', 'glass_returnable': 'Vidro Retornável', 'can': 'Lata Alumínio', 'pet': 'Garrafa PET' };
    return map[type] || type;
}

function updateSkuSelector() {
    const selector = document.getElementById('skuSelect');
    if (selector.options.length !== Object.keys(state.products).length) {
        selector.innerHTML = Object.values(state.products).map(p =>
            `<option value="${p.id}" ${p.id === state.currentSku ? 'selected' : ''}>${p.label} - ${p.brand}</option>`
        ).join('');
    }
    selector.value = state.currentSku;
}

document.getElementById('skuSelect').onchange = (e) => {
    state.currentSku = e.target.value;
    state.processFlowEnd = 0;
    render();
};

window.toggleUnit = (u) => { state.processUnit = u; render(); };
window.updateStageInput = (id, val, conversion) => { const num = parseFloat(val); if (!isNaN(num)) { state.manualInputs[id] = Math.round(num * conversion); render(); } };
window.updateReject = (id, val) => { state.rejects[id] = Math.max(0, parseInt(val) || 0); render(); };
window.updateWithdrawal = (id, val, conversion) => { const num = parseFloat(val); if (!isNaN(num)) { state.withdrawals[id] = Math.round(num * conversion); render(); } };
window.updateProcessStart = (val) => { const n = parseFloat(val); if (!isNaN(n)) { state.processFlowStart = state.processUnit === 'm3' ? n * 10 : n; if (!state.processFlowEnd) state.processFlowEnd = state.processFlowStart; render(); } };
window.updateProcessEnd = (val) => { const n = parseFloat(val); if (!isNaN(n)) { state.processFlowEnd = state.processUnit === 'm3' ? n * 10 : n; render(); } };

window.resetInputs = () => {
    Object.keys(state.manualInputs).forEach(k => state.manualInputs[k] = 0);
    Object.keys(state.rejects).forEach(k => state.rejects[k] = 0);
    state.processFlowStart = 0; state.processFlowEnd = 0;
    render();
};

window.toggleLossMode = () => {
    state.lossDisplayMode = state.lossDisplayMode === 'money' ? 'percent' : 'money';
    render();
};

window.toggleManualOnly = (checked) => {
    // Função para filtrar apenas inputs manuais (se necessário)
    render();
};

// --- DADOS DE DEMONSTRAÇÃO ---
const DEMO_DATA = {
    manualInputs: {
        depalletizer: 729740,      // DPL = 729740 garrafas
        ebi: 729800,               // EBI entrada = 729800 garrafas (+60 reprocessadas)
        filler: 728505,            // ECH = 728505 garrafas
        fbi: 728096,               // Heuft ECH entrada = 728096 garrafas
        rot1: 363600,              // ROT1 = 363600 garrafas
        rot2: 363600,              // ROT2 = 363600 garrafas
        fbi1: 363600,              // Checkmat.1 entrada = 363600 garrafas
        fbi2: 363600,              // Checkmat.2 entrada = 363600 garrafas
        packer1: 724000,           // EPC1 = 724000 garrafas (Checkmat.1: 362200 + Checkmat.2: 361600 = 723800 esperado; +200 reprocessados)
        packer2: 723984,           // EPC2 = 723984 garrafas (-16 garrafas perdidas em transporte)
        palletizer: 723984,        // PAL = 723984 garrafas (mantém de EPC2)
        wrapper: 723744            // ENV = 723744 garrafas (359 paletes)
    },
    rejects: {
        depalletizer: 0,        // DPL não tem rejeitos (apenas despaletização)
        ebi: 1300,              // EBI: Expl = 1300 (rejeitos da inspeção)
        filler: 0,              // ECH não tem rejeitos diretos
        fbi: 830,               // Heuft ECH: Expl = 830 (rejeitos da inspeção)
        rot1: 0,                // ROT1 não tem rejeitos diretos
        rot2: 0,                // ROT2 não tem rejeitos diretos
        fbi1: 1400,             // Checkmat.1: Expl = 1400 (rejeitos da inspeção)
        fbi2: 2000,             // Checkmat.2: Expl = 2000 (rejeitos da inspeção)
        packer1: 0,             // EPC1 não tem rejeitos diretos
        packer2: 6,             // EPC2: -6 pacotes de transporte
        palletizer: 0,          // PAL não tem rejeitos diretos
        wrapper: 0              // ENV não tem rejeitos diretos
    },
    processFlowStart: 2404.0665,  // ECH = 2404,0665 hL
    processFlowEnd: 2388.3552,    // FINAL DE LINHA = 2388,3552 hL
};

window.applyDemo = () => {
    try {
        Object.assign(state.manualInputs, DEMO_DATA.manualInputs);
        Object.assign(state.rejects, DEMO_DATA.rejects);
        state.processFlowStart = DEMO_DATA.processFlowStart;
        state.processFlowEnd = DEMO_DATA.processFlowEnd;
        state.runMode = 'manual';
        render();
    } catch (error) {
        console.error('Erro ao aplicar dados de demonstração:', error);
        alert('Erro ao aplicar demonstração. Verifique o console.');
    }
};

// --- MODAL DE SETTINGS ---
const modal = document.getElementById('settingsModal');
let tempProduct = null;

document.getElementById('btnSettings').onclick = () => {
    loadProductToModal(state.currentSku);
    modal.classList.remove('hidden');
};

document.getElementById('btnCloseSettings').onclick = () => modal.classList.add('hidden');

function loadProductToModal(productId) {
    const product = state.products[productId];
    // Migration check
    if (!product.targets.budgetCostPerHl) {
        product.targets.budgetCostPerHl = 100.00;
    }
    tempProduct = JSON.parse(JSON.stringify(product));
    renderSettingsModal();
}

function createNewProduct() {
    tempProduct = {
        id: 'NEW_' + Date.now(),
        label: 'Novo Produto',
        brand: 'Nova Marca',
        type: 'glass',
        volumeHl: 0.00330,
        palletSize: 1000,
        costs: { liquidHl: 50.00, base_material: 0.50, closure: 0.05, label_set: 0.10, cardboard: 0.20, shrink_film: 0.10, stretch_film: 5.00 },
        targets: { efficiency: 90.0, maxIPOWPct: 1.5, maxIPEPct: 0.8, budgetCostPerHl: 120.00 }
    };
    renderSettingsModal();
}

function renderSettingsModal() {
    const container = document.getElementById('costInputsContainer');

    let html = `
        <div style="grid-column: span 2; display:flex; gap: 10px; margin-bottom: 20px; align-items:center;">
            <label class="text-xs font-bold text-gray-500 uppercase">Editar:</label>
            <select onchange="handleModalProductChange(this.value)" class="w-full border rounded p-2 bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600">
                ${Object.values(state.products).map(p => `<option value="${p.id}" ${p.id === tempProduct.id ? 'selected' : ''}>${p.label}</option>`).join('')}
                <option value="NEW_PRODUCT">+ Criar Novo Produto</option>
            </select>
        </div>
    `;

    // 1. DADOS BÁSICOS
    html += `<h3 class="font-bold text-sm text-brand-gold uppercase border-b border-brand-gold pb-1 mb-4 mt-2 col-span-full">1. Dados do Produto</h3>`;
    html += `
        <div class="cost-input-group"><label>Nome (SKU)</label><input type="text" value="${tempProduct.label}" onchange="updateTempProduct('label', this.value)" class="cost-input-field"></div>
        <div class="cost-input-group"><label>Marca</label><input type="text" value="${tempProduct.brand}" onchange="updateTempProduct('brand', this.value)" class="cost-input-field"></div>
        <div class="cost-input-group"><label>Tipo Recipiente</label>
            <select onchange="updateTempProduct('type', this.value)" class="cost-input-field" style="height:38px">
                <option value="glass" ${tempProduct.type === 'glass' ? 'selected' : ''}>Vidro One Way</option>
                <option value="glass_returnable" ${tempProduct.type === 'glass_returnable' ? 'selected' : ''}>Vidro Retornável</option>
                <option value="can" ${tempProduct.type === 'can' ? 'selected' : ''}>Lata</option>
                <option value="pet" ${tempProduct.type === 'pet' ? 'selected' : ''}>PET</option>
            </select>
        </div>
        <div class="cost-input-group"><label>Volume Unit (hL)</label><input type="number" step="0.00001" value="${tempProduct.volumeHl}" onchange="updateTempProduct('volumeHl', this.value)" class="cost-input-field"></div>
        <div class="cost-input-group"><label>Tamanho Palete (Un)</label><input type="number" value="${tempProduct.palletSize}" onchange="updateTempProduct('palletSize', this.value)" class="cost-input-field"></div>
    `;

    // 2. METAS
    html += `<h3 class="font-bold text-sm text-brand-gold uppercase border-b border-brand-gold pb-1 mb-4 mt-6 col-span-full">2. Metas e Orçamento</h3>`;
    html += `
        <div class="cost-input-group"><label>Eficiência Mínima</label><div class="cost-input-wrapper"><span class="cost-input-currency">%</span><input type="number" step="0.1" value="${tempProduct.targets.efficiency}" onchange="updateTempTarget('efficiency', this.value)" class="cost-input-field"></div></div>
        <div class="cost-input-group"><label>IPOW Máximo</label><div class="cost-input-wrapper"><span class="cost-input-currency">%</span><input type="number" step="0.1" value="${tempProduct.targets.maxIPOWPct}" onchange="updateTempTarget('maxIPOWPct', this.value)" class="cost-input-field"></div></div>
        <div class="cost-input-group"><label>IPE Máximo</label><div class="cost-input-wrapper"><span class="cost-input-currency">%</span><input type="number" step="0.1" value="${tempProduct.targets.maxIPEPct}" onchange="updateTempTarget('maxIPEPct', this.value)" class="cost-input-field"></div></div>
        <div class="cost-input-group"><label>Orçamento Custo/hL</label><div class="cost-input-wrapper"><span class="cost-input-currency">$</span><input type="number" step="0.01" value="${tempProduct.targets.budgetCostPerHl}" onchange="updateTempTarget('budgetCostPerHl', this.value)" class="cost-input-field"></div></div>
    `;

    // 3. CUSTOS
    html += `<h3 class="font-bold text-sm text-brand-gold uppercase border-b border-brand-gold pb-1 mb-4 mt-6 col-span-full">3. Unit Economics ($)</h3>`;

    const costLabels = {
        'liquidHl': 'Líquido (por hL)',
        'base_material': 'Vasilhame (Vidro/Lata/Preforma)',
        'closure': 'Fechamento (Rolha/Tampa)',
        'label_set': 'Rótulos (Total)',
        'cardboard': 'Cartão (Custo do Pack/Cesta)',
        'shrink_film': 'Filme Shrink (Custo do Fardo)',
        'stretch_film': 'Filme Stretch (Custo por Palete)'
    };

    Object.keys(costLabels).forEach(key => {
        const val = tempProduct.costs[key] || 0;
        html += `
        <div class="cost-input-group">
            <label>${costLabels[key]}</label>
            <div class="cost-input-wrapper">
                <span class="cost-input-currency">$</span>
                <input type="number" step="0.01" value="${val}" onchange="updateTempCost('${key}', this.value)" class="cost-input-field">
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

window.handleModalProductChange = (val) => val === 'NEW_PRODUCT' ? createNewProduct() : loadProductToModal(val);
window.updateTempProduct = (field, val) => {
    if (field === 'label' || field === 'brand' || field === 'type') tempProduct[field] = val;
    else tempProduct[field] = parseFloat(val);
};
window.updateTempTarget = (field, val) => tempProduct.targets[field] = parseFloat(val);
window.updateTempCost = (key, val) => tempProduct.costs[key] = parseFloat(val);

document.getElementById('btnSaveSettings').onclick = () => {
    state.products[tempProduct.id] = tempProduct;
    StorageService.saveProducts(state.products);
    state.currentSku = tempProduct.id;
    modal.classList.add('hidden');
    render();
    alert('Configurações salvas com sucesso!');
};

// --- (Troca de Tema) ---
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
}

// Inicialização
lucide.createIcons();
if (!state.products[state.currentSku]) {
    const keys = Object.keys(state.products);
    if (keys.length > 0) state.currentSku = keys[0];
}
render();