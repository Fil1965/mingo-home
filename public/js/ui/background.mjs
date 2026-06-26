import { getJson } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';

export async function initBackground() {
    try {
        const images = await getJson('franjas');
        const promises = [];
        images.forEach((img) => {
            promises.push(
                new Promise((resolve) => {
                    const image = new Image();
                    image.src = img;
                    image.onload = () => {
                        $('body').append(
                            `<img src="${img}" class="bgimage img-fluid d-block w-100 sticky-top position-fixed" alt="Imagen de fondo" margen="50">`
                        );
                        appState.images.push(img);
                        resolve();
                    };
                    image.onerror = () => {
                        console.error('Error al cargar la imagen: ' + img);
                        resolve();
                    };
                })
            );
        });
        await Promise.all(promises);
        scrollBgImage();
    } catch (e) {
        console.error('Error cargando fondos:', e);
    }

    let scrollPending = false;
    $(window).on('scroll', () => {
        if (scrollPending) return;
        scrollPending = true;
        requestAnimationFrame(() => {
            scrollBgImage();
            scrollPending = false;
        });

        if ($(window).scrollTop() > 50) {
            $('header').addClass('shrink');
        } else {
            $('header').removeClass('shrink');
        }
    });
}

export function scrollBgImage() {
    let offset = 90;
    const st = $(window).scrollTop();
    appState.images.forEach((img) => {
        const imagen = $(`img[src="${img}"]`);
        const y = offset + (st * -0.5);
        imagen.css('transform', `translate3d(0, ${y}px, 0)`);
        offset += imagen.height() + (Number(imagen.attr('margen') ?? 50));
    });
}
