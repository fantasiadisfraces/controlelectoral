// ╔════════════════════════════════════════════════════════════════════════════╗
// ║                ARCHIVO DE CONFIGURACIÓN - config.js                          ║
// ║                   Sistema Electoral Bolivia 2026                             ║
// ║                                                                              ║
// ║  Este archivo contiene todas las configuraciones necesarias para conectar   ║
// ║  el sistema con Google Sheets.                                               ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const CONFIG = {
    
    // ══════════════════════════════════════════════════════════════════════════
    // ID DEL DOCUMENTO DE GOOGLE SHEETS
    // ══════════════════════════════════════════════════════════════════════════
    GOOGLE_SHEET_ID: '1FX9nniq3Caw6GEq-x1SWOvgrjQ5bchEaxGVxOxTvJgA',
    
    // ══════════════════════════════════════════════════════════════════════════
    // CREDENCIALES DE GOOGLE API
    // ══════════════════════════════════════════════════════════════════════════
    CLIENT_ID: '488089624210-ns62tr4g9rqov3k2b85965c4p4fto028.apps.googleusercontent.com',
    API_KEY: 'AIzaSyAOhGTjJXHhuUhqf1g2DPCla59xNzftb-Q',
    
    // ══════════════════════════════════════════════════════════════════════════
    // NOMBRES DE LAS HOJAS DE LA BASE DE DATOS
    // ══════════════════════════════════════════════════════════════════════════
    SHEETS: {
        RESULTADOS: 'Resultados',
        FOTOS: 'Fotos',
        CANDIDATOS: 'Candidatos',
        LOG: 'Log'
    }
};
