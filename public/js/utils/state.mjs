/**
 * Estado compartido mutable entre modulos.
 * Los modulos deben mutar propiedades, no reasignar el export.
 */

export const appState = {
    now: new Date(),
    dia: '',
    tim: 5000,
    too: null,
    tooHistorico: null,
    myChart: null,
    weatherChart: null,
    images: [],
    serverConfigOriginal: null,
    previewCurrentPage: 0,
    previewData: [],
    previewTheme: 'noche',
    previewViewMode: 0,
    previewInterval: null
};
