import { getJson, post, postJson } from '../utils/api.mjs';
import { on } from '../utils/events.mjs';
import { html, setHtml } from '../utils/safe-dom.mjs';

export function initMingoTouchs() {
    on('mingotouchs:refresh', refreshMingoTouchs);

    $(document).on('change', '#select-esp32', function () {
        const val = $(this).val();
        if (val) {
            loadEsp32Devices(val);
        } else {
            setHtml($('#mingo-container'), html`
                <div class="list-group-item text-center">Selecciona un ESP32 para empezar.</div>`);
            $('#select-theme').prop('disabled', true);
        }
    });

    $(document).on('change', '#select-theme', async function () {
        const theme = $(this).val();
        const dsp = $('#select-esp32').val();
        if (!dsp || !theme) return;
        try {
            await post('/mingotouchs/theme', { dsp, theme });
            console.log(`Tema para ESP32 ${dsp} cambiado a ${theme}`);
        } catch {
            alert('Error al cambiar el tema.');
        }
    });

    $(document).on('click', '#btn-save-mingo', saveMingoOrder);
    $(document).on('click', '.btn-remove-mingo', async function () {
        const section = $(this).data('section');
        const dsp = $('#select-esp32').val();
        if (!confirm('¿Quitar este dispositivo de la visualizacion del ESP32?')) return;
        try {
            await post('/mingotouchs/remove', { dsp, section });
            loadEsp32Devices(dsp);
        } catch {
            alert('Error al quitar dispositivo.');
        }
    });

    $(document).on('click', '.btn-add-mingo', async function () {
        const section = $(this).data('section');
        const dsp = $('#select-esp32').val();
        try {
            await post('/mingotouchs/add', { dsp, section });
            loadEsp32Devices(dsp);
        } catch {
            alert('Error al anadir dispositivo.');
        }
    });
}

async function refreshMingoTouchs() {
    if (!$('#bloque_mingotouchs').is(':visible')) return;

    try {
        const dsps = await getJson('/mingotouchs');
        const select = $('#select-esp32');
        const currentVal = select.val();
        select.empty().append(html`<option value="">Selecciona un MingoTouch...</option>`);

        dsps.forEach(d => {
            select.append(html`<option value="${d.id}" ${currentVal == d.id ? 'selected' : ''}>${d.name}</option>`);
        });

        if (currentVal) loadEsp32Devices(currentVal);
    } catch (e) {
        console.error('Error al cargar MingoTouchs:', e);
    }
}

async function loadEsp32Devices(dsp) {
    const container = $('#mingo-container');
    const unassignedContainer = $('#mingo-unassigned-container');

    setHtml(container, html`
        <div class="text-center py-3">
            <div class="spinner-border spinner-border-sm text-primary"></div> Cargando...
        </div>`);
    unassignedContainer.empty();
    $('#btn-save-mingo').addClass('d-none');

    try {
        const res = await getJson(`/mingotouchs/${dsp}`);
        const types = ['Consumo', 'Clima', 'Luz', 'Enchufe'];

        let htmlAssigned = '';
        if (res.assigned.length === 0) {
            htmlAssigned = html`
                <div class="list-group-item text-center text-muted py-4">
                    No hay dispositivos asignados. Anade uno de la lista inferior.
                </div>`;
        } else {
            res.assigned.forEach(d => {
                let options = '';
                if (d.section !== 'WEATHER' && d.section !== 'ENERGY') {
                    types.forEach(t => {
                        options += html`<option value="${t}" ${d.type === t ? 'selected' : ''}>${t}</option>`;
                    });
                }

                htmlAssigned += html`
                    <div class="list-group-item list-group-item-action d-flex align-items-center mingo-item p-2"
                         draggable="true" data-section="${d.section}" data-id="${d.id}">
                        <div class="me-3 text-muted">
                            <i class="bi bi-grip-vertical fs-4"></i>
                        </div>
                        <div class="flex-grow-1">
                            <div class="fw-bold">${d.name}</div>
                            <div class="d-flex align-items-center mt-1">
                                ${d.section !== 'WEATHER' && d.section !== 'ENERGY'
                                    ? html`
                                        <select class="form-select form-select-sm w-auto me-2 mingo-category-select">
                                            ${options}
                                        </select>`
                                    : html`<span class="badge bg-info text-dark me-2">Sistema</span>`}
                                <span class="small text-muted">Sujeto ${d.section}</span>
                            </div>
                        </div>
                        <div class="text-end">
                            <span class="badge bg-secondary rounded-pill d-block mb-1 mingo-page-badge">Pag. ${d.page}</span>
                            <button class="btn btn-sm btn-outline-danger btn-remove-mingo" data-section="${d.section}"
                                title="Quitar de este MingoTouch">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            $('#btn-save-mingo').removeClass('d-none');
        }
        setHtml(container, html`${htmlAssigned}`);

        let htmlUnassigned = '';
        if (res.unassigned.length === 0) {
            htmlUnassigned = html`
                <div class="list-group-item text-center text-muted small">
                    Todos los dispositivos estan asignados.
                </div>`;
        } else {
            res.unassigned.forEach(d => {
                htmlUnassigned += html`
                    <div class="list-group-item d-flex align-items-center p-2">
                        <div class="flex-grow-1">
                            <div class="fw-bold small">${d.name}</div>
                            <div class="text-muted small-id">ID: ${d.id}</div>
                        </div>
                        <button class="btn btn-sm btn-success btn-add-mingo" data-section="${d.section}">
                            <i class="bi bi-plus-lg"></i> Anadir
                        </button>
                    </div>
                `;
            });
        }
        setHtml(unassignedContainer, html`${htmlUnassigned}`);

        $('#select-theme').val(res.theme || 'noche').prop('disabled', false);
        $('#btn-preview-mingo').removeClass('d-none');

        initDragAndDrop();
        updatePageNumbers();
    } catch (e) {
        console.error('Error al cargar dispositivos del ESP32:', e);
    }
}

function initDragAndDrop() {
    const container = document.getElementById('mingo-container');
    if (!container) return;
    const draggables = container.querySelectorAll('.mingo-item');

    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', () => draggable.classList.add('dragging'));
        draggable.addEventListener('dragend', () => {
            draggable.classList.remove('dragging');
            updatePageNumbers();
        });
    });

    container.addEventListener('dragover', e => {
        e.preventDefault();
        const afterElement = getDragAfterElement(container, e.clientY, e.clientX);
        const draggable = document.querySelector('.dragging');
        if (!draggable) return;
        if (afterElement == null) {
            container.appendChild(draggable);
        } else {
            container.insertBefore(draggable, afterElement);
        }
    });
}

function getDragAfterElement(container, y, x) {
    const draggableElements = [...container.children].filter(child =>
        !child.classList.contains('dragging') && child.classList.contains('mingo-item')
    );

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const boxCenterX = box.left + box.width / 2;
        const boxCenterY = box.top + box.height / 2;
        const distance = Math.hypot(x - boxCenterX, y - boxCenterY);
        if (distance < closest.distance) {
            return { distance, element: child };
        }
        return closest;
    }, { distance: Number.POSITIVE_INFINITY }).element;
}

function updatePageNumbers() {
    let count = 0;
    $('#mingo-container .mingo-item').each(function (index) {
        $(this).find('.mingo-page-badge').text('Pag. ' + (index + 1));
        count++;
    });
    $('#count-mingo-pages').text(count);
}

async function saveMingoOrder() {
    const dsp = $('#select-esp32').val();
    const order = [];

    $('#mingo-container .mingo-item').each(function (index) {
        const item = $(this);
        const section = item.data('section');
        const type = item.find('.mingo-category-select').val();

        let finalType = type;
        if (section === 'WEATHER') finalType = 'Weather';
        else if (section === 'ENERGY') finalType = 'Energy';
        else if (!type) finalType = 'Enchufe';

        order.push({ section, page: index + 1, type: finalType });
    });

    const btn = $(this);
    btn.prop('disabled', true).html(html`<span class="spinner-border spinner-border-sm"></span> Guardando...`);

    try {
        await postJson('/mingotouchs/reorder', { dsp, order });
        loadEsp32Devices(dsp);
    } catch {
        alert('Error al guardar el orden.');
    } finally {
        btn.prop('disabled', false).text('Guardar');
    }
}
