// ╔════════════════════════════════════════════════════════════════════════════╗
// ║                 SISTEMA DE LLENADO ELECTORAL - script.js                    ║
// ║                           Versión Corregida                                  ║
// ╚════════════════════════════════════════════════════════════════════════════╝

// ══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE GOOGLE API (desde config.js)
// ══════════════════════════════════════════════════════════════════════════

const CLIENT_ID = CONFIG.CLIENT_ID;
const API_KEY = CONFIG.API_KEY;
const SPREADSHEET_ID = CONFIG.GOOGLE_SHEET_ID;
const SHEETS = CONFIG.SHEETS;

const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

const SCOPES =
    'https://www.googleapis.com/auth/spreadsheets ' +
    'https://www.googleapis.com/auth/userinfo.profile ' +
    'https://www.googleapis.com/auth/userinfo.email';

// ══════════════════════════════════════════════════════════════════════════
// VARIABLES DE ESTADO
// ══════════════════════════════════════════════════════════════════════════

let tokenClient;
let gapiInited = false;
let gisInited = false;
let usuarioGoogle = false;
let emailUsuario = '';

// Cache de candidatos
let candidatosPorMunicipio = {};

// Estado del mapa y datos
let recintos = [];
let datosLlenados = {};
let recintoActual = null;
let mesaActual = 1;

// Mapa Leaflet
const map = L.map('map', {
  zoomControl: true,
  attributionControl: false
}).setView([-16.5, -64.5], 6);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19
}).addTo(map);

let markersLayer = L.layerGroup().addTo(map);

// ══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN DE GOOGLE API
// ══════════════════════════════════════════════════════════════════════════

function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: [DISCOVERY_DOC]
        });
        gapiInited = true;
        console.log('✅ Google API inicializada');
        checkReady();
    } catch (e) {
        console.error('❌ Error GAPI:', e);
        showToast('Error al inicializar Google API', 'error');
    }
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: handleTokenResponse
    });
    gisInited = true;
    console.log('✅ Google Identity Services cargado');
    checkReady();
}

function checkReady() {
    if (gapiInited && gisInited) {
        console.log('🗳️ Sistema Electoral listo');
        const savedToken = localStorage.getItem('electoral_google_token');
        if (savedToken) {
            gapi.client.setToken({ access_token: savedToken });
            verificarToken();
        } else {
            updateConnectionStatus(false);
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// AUTENTICACIÓN CON GOOGLE
// ══════════════════════════════════════════════════════════════════════════

function handleGoogleAuth() {
    if (usuarioGoogle) {
        // Desconectar
        const token = gapi.client.getToken();
        if (token) {
            google.accounts.oauth2.revoke(token.access_token, () => {
                gapi.client.setToken(null);
                localStorage.removeItem('electoral_google_token');
                usuarioGoogle = false;
                emailUsuario = '';
                updateConnectionStatus(false);
                showToast('Sesión cerrada correctamente', 'success');
            });
        }
    } else {
        // Conectar
        tokenClient.requestAccessToken({ prompt: 'consent' });
    }
}

async function handleTokenResponse(response) {
    if (response.error !== undefined) {
        console.error('Error en token:', response);
        showToast('Error de autenticación: ' + response.error, 'error');
        return;
    }

    const token = gapi.client.getToken().access_token;
    localStorage.setItem('electoral_google_token', token);
    
    await obtenerInfoUsuario();
    usuarioGoogle = true;
    updateConnectionStatus(true);
    
    showToast(`✅ Conectado como ${emailUsuario}`, 'success');
    
    // Cargar datos
    await cargarCandidatos();
    await cargarDatosExistentes();
}

async function verificarToken() {
    try {
        const token = gapi.client.getToken();
        if (!token) {
            updateConnectionStatus(false);
            return;
        }

        const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + token.access_token);
        
        if (response.ok) {
            await obtenerInfoUsuario();
            usuarioGoogle = true;
            updateConnectionStatus(true);
            await cargarCandidatos();
            await cargarDatosExistentes();
        } else {
            localStorage.removeItem('electoral_google_token');
            gapi.client.setToken(null);
            updateConnectionStatus(false);
        }
    } catch (e) {
        console.error('Error verificando token:', e);
        updateConnectionStatus(false);
    }
}

async function obtenerInfoUsuario() {
    try {
        const token = gapi.client.getToken().access_token;
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        emailUsuario = data.email;
        document.getElementById('userEmail').textContent = emailUsuario;
    } catch (e) {
        console.error('Error obteniendo info:', e);
        emailUsuario = 'Usuario';
    }
}

function updateConnectionStatus(connected) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const btnGoogle = document.getElementById('btnGoogle');
    const btnText = document.getElementById('btnGoogleText');
    const userEmail = document.getElementById('userEmail');

    if (connected) {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'Conectado';
        btnText.textContent = 'Desconectar';
        userEmail.style.display = 'inline-block';
    } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Desconectado';
        btnText.textContent = 'Conectar';
        userEmail.style.display = 'none';
        userEmail.textContent = '';
    }
}

// ══════════════════════════════════════════════════════════════════════════
// FUNCIONES DE GOOGLE SHEETS
// ══════════════════════════════════════════════════════════════════════════

async function leerHojaCompleta(nombreHoja) {
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: nombreHoja
        });

        const rows = response.result.values;
        if (!rows || rows.length === 0) return [];

        const headers = rows[0].map(h => h.toLowerCase().trim());
        const data = rows.slice(1);

        return data.map(row => {
            const obj = {};
            headers.forEach((header, i) => {
                obj[header] = row[i] || '';
            });
            return obj;
        });
    } catch (e) {
        console.error(`Error leyendo ${nombreHoja}:`, e);
        throw e;
    }
}

async function agregarFilas(nombreHoja, filas) {
    try {
        const response = await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: nombreHoja,
            valueInputOption: 'RAW',
            resource: { values: filas }
        });
        return response.result;
    } catch (e) {
        console.error(`Error agregando filas a ${nombreHoja}:`, e);
        throw e;
    }
}

// ══════════════════════════════════════════════════════════════════════════
// CARGAR CANDIDATOS
// ══════════════════════════════════════════════════════════════════════════

async function cargarCandidatos() {
    if (!usuarioGoogle) {
        showToast('Debes conectar con Google primero', 'warning');
        return false;
    }

    try {
        showLoading('Cargando candidatos...');
        
        const candidatos = await leerHojaCompleta(SHEETS.CANDIDATOS);
        
        if (!candidatos || candidatos.length === 0) {
            console.warn('⚠️ No hay candidatos');
            hideLoading();
            return false;
        }

        candidatosPorMunicipio = {};
        candidatos.forEach(c => {
            const municipio = (c.municipio || '').trim();
            if (!municipio) return;

            if (!candidatosPorMunicipio[municipio]) {
                candidatosPorMunicipio[municipio] = [];
            }

            candidatosPorMunicipio[municipio].push({
                partido: (c.partido || '').trim(),
                nombre: (c.candidato || c.nombre || '').trim(),
                cargo: (c.cargo || 'Alcalde').trim(),
                color: (c.color || '#999999').trim(),
                orden: parseInt(c.orden || 999)
            });
        });

        Object.keys(candidatosPorMunicipio).forEach(muni => {
            candidatosPorMunicipio[muni].sort((a, b) => a.orden - b.orden);
        });

        console.log(`✅ Candidatos cargados: ${Object.keys(candidatosPorMunicipio).length} municipios`);
        hideLoading();
        return true;

    } catch (error) {
        console.error('Error cargando candidatos:', error);
        hideLoading();
        showToast('Error al cargar candidatos', 'error');
        return false;
    }
}

function obtenerCandidatosMunicipio(municipio) {
    const municipioNormalizado = municipio.trim();

    if (candidatosPorMunicipio[municipioNormalizado]) {
        return candidatosPorMunicipio[municipioNormalizado];
    }

    // Fallback
    return [
        { partido: 'IH', nombre: 'Innovación Humana', cargo: 'Alcalde', color: '#8B5CF6', orden: 1 },
        { partido: 'MAS-IPSP', nombre: 'MAS-IPSP', cargo: 'Alcalde', color: '#1E3A8A', orden: 2 },
        { partido: 'CC', nombre: 'Comunidad Ciudadana', cargo: 'Alcalde', color: '#F97316', orden: 3 }
    ];
}

// ══════════════════════════════════════════════════════════════════════════
// FUNCIONES DEL MAPA
// ══════════════════════════════════════════════════════════════════════════

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const msg = document.getElementById('toastMessage');

    icon.textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️';
    msg.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => toast.classList.remove('show'), 3500);
}

function showLoading(text = 'Cargando...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').classList.add('show');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('show');
}

function getEstadoRecinto(codigo) {
    const datos = datosLlenados[codigo];
    if (!datos) return 'Pendiente';

    const numMesas = recintos.find(r => r.c === codigo)?.ms || 1;
    const mesasConDatos = Object.keys(datos.mesas || {}).length;

    if (mesasConDatos === 0) return 'Pendiente';
    if (mesasConDatos < numMesas) return 'Parcial';

    let todasCompletas = true;
    for (let i = 1; i <= numMesas; i++) {
        const mesa = datos.mesas[i];
        if (!mesa || !mesa.votos || Object.keys(mesa.votos).length === 0 || !mesa.fotos || mesa.fotos.length === 0) {
            todasCompletas = false;
            break;
        }
    }

    return todasCompletas ? 'Completado' : 'Parcial';
}

function getColorEstado(estado) {
    switch (estado) {
        case 'Completado': return '#22c55e';
        case 'Parcial': return '#f59e0b';
        default: return '#DDD6FE';
    }
}

function renderizarMapa() {
    markersLayer.clearLayers();

    const filtros = {
        dep: document.getElementById('selDep')?.value || 'Todos',
        estado: document.getElementById('selEstado')?.value || 'Todos',
        search: document.getElementById('searchRecinto')?.value?.toLowerCase().trim() || ''
    };

    const recintosFiltrados = recintos.filter(r => {
        if (filtros.dep !== 'Todos' && r.d !== filtros.dep) return false;
        if (filtros.estado !== 'Todos' && getEstadoRecinto(r.c) !== filtros.estado) return false;
        if (filtros.search) {
            const searchIn = `${r.c} ${r.r} ${r.m}`.toLowerCase();
            if (!searchIn.includes(filtros.search)) return false;
        }
        return true;
    });

    recintosFiltrados.forEach(r => {
        const estado = getEstadoRecinto(r.c);
        const color = getColorEstado(estado);

        const marker = L.circleMarker([r.la, r.lo], {
            radius: 6,
            fillColor: color,
            fillOpacity: 0.75,
            stroke: true,
            color: 'rgba(0,0,0,.1)',
            weight: 1
        });

        marker.bindPopup(crearPopupRecinto(r, estado), {
            className: 'custom-popup',
            maxWidth: 300
        });

        marker.on('mouseover', function() {
            this.setStyle({
                fillOpacity: 1,
                weight: 2,
                color: 'rgba(139,92,246,.5)',
                radius: 8
            });
        });

        marker.on('mouseout', function() {
            if (!this.isPopupOpen()) {
                this.setStyle({
                    fillOpacity: 0.75,
                    weight: 1,
                    color: 'rgba(0,0,0,.1)',
                    radius: 6
                });
            }
        });

        markersLayer.addLayer(marker);
    });

    actualizarEstadisticas();
}

function crearPopupRecinto(recinto, estado) {
    let estadoBadge = '';
    if (estado === 'Completado') {
        estadoBadge = '<div class="popup-status completado">✅ Completado</div>';
    } else if (estado === 'Parcial') {
        estadoBadge = '<div class="popup-status parcial">⚠️ Parcial</div>';
    } else {
        estadoBadge = '<div class="popup-status pendiente">⏳ Pendiente</div>';
    }

    return `
        <div class="popup-name">${recinto.r}</div>
        <div class="popup-code">Código: ${recinto.c}</div>
        <div class="popup-info">
            ${recinto.m}<br>
            ${recinto.d}<br>
            📊 ${recinto.ms || 1} mesa${recinto.ms !== 1 ? 's' : ''} · ${recinto.h || 0} habilitados
        </div>
        ${estadoBadge}
        <button class="popup-btn" onclick="abrirFormularioLlenado('${recinto.c}')">
            ${estado === 'Pendiente' ? '📝 Llenar Datos' : '✏️ Editar Datos'}
        </button>
    `;
}

// ══════════════════════════════════════════════════════════════════════════
// FORMULARIO Y MODAL - continuará en siguiente parte
// ══════════════════════════════════════════════════════════════════════════

function abrirFormularioLlenado(codigo) {
    if (!usuarioGoogle) {
        showToast('⚠️ Debes conectar con Google primero', 'warning');
        return;
    }

    recintoActual = recintos.find(r => r.c === codigo);
    if (!recintoActual) {
        showToast('Recinto no encontrado', 'error');
        return;
    }

    mesaActual = 1;

    if (!datosLlenados[codigo]) {
        datosLlenados[codigo] = {
            mesas: {},
            totales: {}
        };
    }

    document.getElementById('modalTitle').textContent = `Llenado de Datos - ${recintoActual.r}`;
    document.getElementById('modalSubtitle').textContent =
        `Código: ${codigo} · ${recintoActual.m} · ${recintoActual.d} · ${recintoActual.ms || 1} mesa(s)`;

    renderizarFormulario();
    document.getElementById('modalLlenado').classList.add('open');
}

function renderizarFormulario() {
    const numMesas = recintoActual.ms || 1;
    const candidatos = obtenerCandidatosMunicipio(recintoActual.m);

    let html = '';

    if (numMesas > 1) {
        html += '<div class="mesa-tabs">';
        for (let i = 1; i <= numMesas; i++) {
            const datos = datosLlenados[recintoActual.c]?.mesas?.[i];
            const tieneVotos = datos && datos.votos && Object.keys(datos.votos).length > 0;
            const tieneFotos = datos && datos.fotos && datos.fotos.length > 0;
            const badge = tieneVotos && tieneFotos ? ' ✓' : tieneVotos || tieneFotos ? ' ●' : '';

            html += `<button class="mesa-tab ${i === mesaActual ? 'active' : ''}" 
                       onclick="cambiarMesa(${i})">
                 Mesa ${i}${badge}
               </button>`;
        }
        html += '</div>';
    }

    html += '<div class="form-content">';
    html += '<div class="form-section">';
    html += '<div class="form-section-title">📊 Votos por Candidato</div>';
    html += '<div class="candidatos-grid">';

    const votosActuales = datosLlenados[recintoActual.c]?.mesas?.[mesaActual]?.votos || {};

    candidatos.forEach(cand => {
        const valor = votosActuales[cand.partido] || '';
        html += `
      <div class="cand-item">
        <div class="cand-color" style="background: ${cand.color}"></div>
        <div class="cand-info">
          <div class="cand-partido">${cand.partido}</div>
          <div class="cand-nombre">${cand.nombre}</div>
        </div>
        <input type="number" 
               class="cand-votos" 
               min="0" 
               value="${valor}"
               placeholder="0"
               data-partido="${cand.partido}"
               onchange="actualizarVoto('${cand.partido}', this.value)">
      </div>
    `;
    });

    html += '</div></div>';

    // Sección de fotos
    html += '<div class="form-section">';
    html += '<div class="form-section-title">📸 Fotos de Actas</div>';

    const fotosActuales = datosLlenados[recintoActual.c]?.mesas?.[mesaActual]?.fotos || [];

    html += '<div class="fotos-list">';
    fotosActuales.forEach((foto, i) => {
        html += `
      <div class="foto-item">
        <input type="text" value="${foto}" class="foto-url" readonly>
        <button class="btn-icon" onclick="eliminarFoto(${i})" title="Eliminar">🗑️</button>
      </div>
    `;
    });
    html += '</div>';

    html += `
    <div class="foto-add">
      <input type="text" id="inputNuevaFoto" placeholder="URL de la foto" class="foto-input">
      <button class="btn-secondary" onclick="agregarFoto()">➕ Agregar Foto</button>
    </div>
  `;

    html += '</div>';

    if (numMesas > 1) {
        html += '<div class="form-section resumen-section">';
        html += '<div class="form-section-title">📈 Resumen Total del Recinto</div>';
        html += '<div id="resumenTotales">Llena las mesas para ver el resumen</div>';
        html += '</div>';
    }

    html += '</div>';

    document.getElementById('modalBody').innerHTML = html;

    if (numMesas > 1) {
        actualizarResumenTotales();
    }
}

function cambiarMesa(numMesa) {
    mesaActual = numMesa;
    renderizarFormulario();
}

function actualizarVoto(partido, valor) {
    const codigo = recintoActual.c;

    if (!datosLlenados[codigo].mesas[mesaActual]) {
        datosLlenados[codigo].mesas[mesaActual] = { votos: {}, fotos: [] };
    }

    const votos = parseInt(valor) || 0;
    datosLlenados[codigo].mesas[mesaActual].votos[partido] = votos;

    actualizarResumenTotales();
}

function agregarFoto() {
    const input = document.getElementById('inputNuevaFoto');
    const url = input.value.trim();

    if (!url) {
        showToast('⚠️ Ingresa una URL válida', 'warning');
        return;
    }

    const codigo = recintoActual.c;

    if (!datosLlenados[codigo].mesas[mesaActual]) {
        datosLlenados[codigo].mesas[mesaActual] = { votos: {}, fotos: [] };
    }

    datosLlenados[codigo].mesas[mesaActual].fotos.push(url);
    input.value = '';

    renderizarFormulario();
    showToast('✅ Foto agregada', 'success');
}

function eliminarFoto(index) {
    const codigo = recintoActual.c;
    datosLlenados[codigo].mesas[mesaActual].fotos.splice(index, 1);
    renderizarFormulario();
    showToast('🗑️ Foto eliminada', 'success');
}

function actualizarResumenTotales() {
    const codigo = recintoActual.c;
    const numMesas = recintoActual.ms || 1;

    if (numMesas === 1) return;

    const totales = {};
    const candidatos = obtenerCandidatosMunicipio(recintoActual.m);

    for (let i = 1; i <= numMesas; i++) {
        const mesa = datosLlenados[codigo]?.mesas?.[i];
        if (mesa && mesa.votos) {
            Object.entries(mesa.votos).forEach(([partido, votos]) => {
                totales[partido] = (totales[partido] || 0) + votos;
            });
        }
    }

    const totalGeneral = Object.values(totales).reduce((a, b) => a + b, 0);

    if (totalGeneral === 0) {
        document.getElementById('resumenTotales').innerHTML = 'Llena las mesas para ver el resumen';
        return;
    }

    let html = '<div class="totales-grid">';

    candidatos.forEach(cand => {
        const votos = totales[cand.partido] || 0;
        const porcentaje = totalGeneral > 0 ? ((votos / totalGeneral) * 100).toFixed(1) : 0;

        if (votos > 0) {
            html += `
        <div class="total-item">
          <div class="total-color" style="background: ${cand.color}"></div>
          <div class="total-info">
            <div class="total-partido">${cand.partido}</div>
            <div class="total-votos">${votos.toLocaleString('es-BO')} votos (${porcentaje}%)</div>
          </div>
        </div>
      `;
        }
    });

    html += '</div>';
    html += `<div class="total-general">Total: ${totalGeneral.toLocaleString('es-BO')} votos</div>`;

    document.getElementById('resumenTotales').innerHTML = html;
}

function calcularTotales(codigo) {
    const recinto = recintos.find(r => r.c === codigo);
    if (!recinto) return;

    const numMesas = recinto.ms || 1;
    const totales = {};

    for (let i = 1; i <= numMesas; i++) {
        const mesa = datosLlenados[codigo]?.mesas?.[i];
        if (mesa && mesa.votos) {
            Object.entries(mesa.votos).forEach(([partido, votos]) => {
                totales[partido] = (totales[partido] || 0) + votos;
            });
        }
    }

    datosLlenados[codigo].totales = totales;
    return totales;
}

// ══════════════════════════════════════════════════════════════════════════
// GUARDAR DATOS
// ══════════════════════════════════════════════════════════════════════════

async function guardarDatos() {
    if (!usuarioGoogle) {
        showToast('⚠️ Debes conectar con Google', 'warning');
        return;
    }

    const codigo = recintoActual.c;
    const datos = datosLlenados[codigo];

    if (!datos || !datos.mesas || Object.keys(datos.mesas).length === 0) {
        showToast('⚠️ No hay datos para guardar', 'warning');
        return;
    }

    showLoading('Guardando en Google Sheets...');

    try {
        const totales = calcularTotales(codigo);
        const candidatos = obtenerCandidatosMunicipio(recintoActual.m);
        const timestamp = new Date().toLocaleString('es-BO');

        // Preparar resultados
        const filasResultados = [];
        Object.entries(totales).forEach(([partido, votos]) => {
            const cand = candidatos.find(c => c.partido === partido);
            const totalVotos = Object.values(totales).reduce((a, b) => a + b, 0);
            const porcentaje = totalVotos > 0 ? ((votos / totalVotos) * 100).toFixed(2) : 0;

            filasResultados.push([
                codigo,
                recintoActual.m,
                partido,
                cand?.nombre || partido,
                votos,
                porcentaje,
                timestamp
            ]);
        });

        // Preparar fotos
        const filasFotos = [];
        Object.entries(datos.mesas).forEach(([numMesa, mesa]) => {
            if (mesa.fotos && mesa.fotos.length > 0) {
                mesa.fotos.forEach(url => {
                    filasFotos.push([
                        codigo,
                        `Mesa ${numMesa}`,
                        url,
                        timestamp,
                        emailUsuario || 'Sistema Web'
                    ]);
                });
            }
        });

        // Guardar
        const promesas = [];

        if (filasResultados.length > 0) {
            promesas.push(agregarFilas(SHEETS.RESULTADOS, filasResultados));
        }

        if (filasFotos.length > 0) {
            promesas.push(agregarFilas(SHEETS.FOTOS, filasFotos));
        }

        // Log
        const filaLog = [[
            timestamp,
            codigo,
            'GUARDADO',
            emailUsuario || 'Sistema Web',
            `${filasResultados.length} resultados, ${filasFotos.length} fotos`
        ]];
        promesas.push(agregarFilas(SHEETS.LOG, filaLog));

        await Promise.all(promesas);

        hideLoading();
        const totalVotos = Object.values(totales).reduce((a, b) => a + b, 0);
        showToast(`✅ Datos guardados: ${totalVotos} votos totales`, 'success');

        cerrarModal();
        renderizarMapa();

    } catch (error) {
        hideLoading();
        showToast('❌ Error al guardar: ' + error.message, 'error');
        console.error('Error:', error);
    }
}

// ══════════════════════════════════════════════════════════════════════════
// CARGAR DATOS EXISTENTES
// ══════════════════════════════════════════════════════════════════════════

async function cargarDatosExistentes() {
    if (!usuarioGoogle) {
        showToast('Conecta con Google primero', 'warning');
        return;
    }

    showLoading('Cargando datos...');

    try {
        datosLlenados = {};

        const resultados = await leerHojaCompleta(SHEETS.RESULTADOS);
        if (resultados && resultados.length > 0) {
            resultados.forEach(r => {
                const codigo = String(r.codigo || '').trim();
                const partido = (r.partido || '').trim();
                const votos = parseInt(r.votos || 0);

                if (!codigo || !partido) return;

                if (!datosLlenados[codigo]) {
                    datosLlenados[codigo] = { mesas: {}, totales: {} };
                }
                if (!datosLlenados[codigo].mesas[1]) {
                    datosLlenados[codigo].mesas[1] = { votos: {}, fotos: [] };
                }
                datosLlenados[codigo].mesas[1].votos[partido] = votos;
            });
        }

        const fotosData = await leerHojaCompleta(SHEETS.FOTOS);
        if (fotosData && fotosData.length > 0) {
            fotosData.forEach(f => {
                const codigo = String(f.codigo || '').trim();
                const url = (f.url_foto || '').trim();
                const mesa = (f.mesa || 'Mesa 1').trim();
                const numMesa = parseInt(mesa.match(/\d+/)?.[0] || '1');

                if (!codigo || !url) return;

                if (!datosLlenados[codigo]) {
                    datosLlenados[codigo] = { mesas: {}, totales: {} };
                }
                if (!datosLlenados[codigo].mesas[numMesa]) {
                    datosLlenados[codigo].mesas[numMesa] = { votos: {}, fotos: [] };
                }
                datosLlenados[codigo].mesas[numMesa].fotos.push(url);
            });
        }

        Object.keys(datosLlenados).forEach(codigo => {
            const recinto = recintos.find(r => r.c === codigo);
            if (recinto) {
                recintoActual = recinto;
                calcularTotales(codigo);
            }
        });

        hideLoading();
        const numCargados = Object.keys(datosLlenados).length;

        renderizarMapa();
        showToast(`✅ Datos cargados: ${numCargados} recintos`, 'success');

    } catch (error) {
        hideLoading();
        showToast('Error al cargar datos', 'error');
        console.error(error);
    }
}

// ══════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS Y FILTROS
// ══════════════════════════════════════════════════════════════════════════

function actualizarEstadisticas() {
    const completados = recintos.filter(r => getEstadoRecinto(r.c) === 'Completado').length;
    const pendientes = recintos.filter(r => getEstadoRecinto(r.c) === 'Pendiente').length;

    document.getElementById('statCargados').textContent = `${completados} recintos cargados`;
    document.getElementById('statPendientes').textContent = `${pendientes} pendientes`;

    if (completados > 0) {
        document.getElementById('statCargados').className = 'hdr-pill ok';
    }
}

function llenarFiltros() {
    const deps = [...new Set(recintos.map(r => r.d))].sort();
    const selDep = document.getElementById('selDep');
    selDep.innerHTML = '<option value="Todos">Todos los departamentos</option>';
    deps.forEach(d => {
        selDep.innerHTML += `<option value="${d}">${d}</option>`;
    });
}

// ══════════════════════════════════════════════════════════════════════════
// MODAL Y EVENTOS
// ══════════════════════════════════════════════════════════════════════════

function cerrarModal() {
    document.getElementById('modalLlenado').classList.remove('open');
    recintoActual = null;
    mesaActual = 1;
}

document.getElementById('btnCloseModal').addEventListener('click', cerrarModal);
document.getElementById('btnCancelar').addEventListener('click', cerrarModal);
document.getElementById('btnGuardar').addEventListener('click', guardarDatos);

document.getElementById('selDep')?.addEventListener('change', renderizarMapa);
document.getElementById('selEstado')?.addEventListener('change', renderizarMapa);
document.getElementById('searchRecinto')?.addEventListener('input', renderizarMapa);

document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('show');
    document.getElementById('btnToggleSidebar').classList.toggle('active');
});

document.addEventListener('click', e => {
    if (window.innerWidth <= 768) {
        if (!e.target.closest('.sidebar') && !e.target.closest('#btnToggleSidebar')) {
            document.getElementById('sidebar').classList.remove('show');
            document.getElementById('btnToggleSidebar')?.classList.remove('active');
        }
    }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('modalLlenado').classList.contains('open')) {
        cerrarModal();
    }
});

// ══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════════════

(function init() {
    if (typeof R !== 'undefined' && R.length > 0) {
        recintos = R.map(r => ({ ...r }));

        llenarFiltros();
        renderizarMapa();

        console.log(`✅ ${recintos.length} recintos cargados`);
    } else {
        showToast('Error: No se encontraron datos de recintos', 'error');
    }
})();
