/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Content Category Screen View (Games & Virtual Run)
 * Innovative poster cards, YouTube thumbnail fallback cascade, and native launch dispatch.
 */

window.CategoryScreen = (function () {
  'use strict';

  let currentCategory = 'games';
  let isLaunching = false;

  async function onMount(container, params = {}) {
    currentCategory = params.category || 'games';
    const isRun = currentCategory === 'virtual_run';

    container.innerHTML = `
      <div class="category-header">
        <div class="category-title-group">
         <button type="button" class="back-btn focusable" id="cat-back-btn" tabindex="0">
  ${window.Utils.getIcon('arrowLeft')}<span>${window.t('hint_back')}</span>
</button>
          <h1 class="category-title">${isRun ? window.t('virtual_run') : window.t('games')}</h1>
          <span class="category-count-badge" id="cat-count-badge">Loading...</span>
        </div>
        <div>
          <button type="button" class="btn-secondary focusable" id="cat-retry-btn" tabindex="0" style="display: none;">
            ${window.t('retry')}
          </button>
        </div>
      </div>

      <div class="catalog-carousel-viewport">
        <div class="catalog-carousel-track" id="cat-carousel-track" data-focus-group="catalog">
          <!-- Skeleton Loaders -->
          ${createSkeletonCards(4)}
        </div>
      </div>
    `;

    setupHeaderEvents(container);

    // 1. Render locally cached content immediately for instant display
    const cachedData = await window.Data.getLocalCategoryData(currentCategory);
    const cachedItems = window.Data.getItemsArray(cachedData);

    if (cachedItems.length > 0) {
      renderCards(cachedItems);
    }

    // 2. Perform background synchronization with GitHub raw
    window.Data.syncCategory(currentCategory, (newItem) => {
      appendCardProgressively(newItem);
    }).then((updatedData) => {
      const allItems = window.Data.getItemsArray(updatedData);
      renderCards(allItems);
    }).catch(() => {
      if (cachedItems.length === 0) {
        showEmptyState();
      }
    });
  }

  function setupHeaderEvents(container) {
    const backBtn = container.querySelector('#cat-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.Router.handleBack();
      });
    }

    const retryBtn = container.querySelector('#cat-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        retryBtn.style.display = 'none';
        window.Data.syncCategory(currentCategory, (newItem) => {
          appendCardProgressively(newItem);
        }).then(data => {
          renderCards(window.Data.getItemsArray(data));
        });
      });
    }
  }

  function createSkeletonCards(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="catalog-card catalog-card-skeleton">
          <div style="height: 100%;"></div>
        </div>
      `;
    }
    return html;
  }

function renderCards(items) {
  const track = document.getElementById('cat-carousel-track');
  const badge = document.getElementById('cat-count-badge');
  if (!track) return;

  if (!items || items.length === 0) {
    showEmptyState();
    return;
  }

  if (badge) badge.textContent = window.t('content_count', { count: items.length });

  // Nothing changed -> don't touch the DOM (keeps focus ring + scroll stable)
  const sig = items.map(i => i.id).join(',');
  if (track.dataset.sig === sig && track.querySelector('.catalog-card[data-item-id]')) return;

  // Remember which card has the focus so we can restore it after the rebuild
  const f = window.Focus && window.Focus.getCurrent();
  const focusedId = f && track.contains(f) ? f.getAttribute('data-item-id') : null;

  track.innerHTML = items.map((item, idx) => buildCardHtml(item, idx)).join('');
  track.dataset.sig = sig;
  setupCardInteractions(track, items);
  track.querySelectorAll('.catalog-card-poster').forEach(handleImageFallbacks);

  if (focusedId) {
    const again = track.querySelector(`.catalog-card[data-item-id="${focusedId}"]`);
    if (again) window.Focus.setFocus(again);
  }
}

  function appendCardProgressively(newItem) {
    const track = document.getElementById('cat-carousel-track');
    if (!track) return;

    // Remove empty state or skeletons if present
    const skeletons = track.querySelectorAll('.catalog-card-skeleton, .empty-state-wrap');
    skeletons.forEach(s => s.parentNode && s.parentNode.removeChild(s));

    // Check if card is already appended
    if (track.querySelector(`.catalog-card[data-item-id="${newItem.id}"]`)) {
      return;
    }

    const temp = document.createElement('div');
    temp.innerHTML = buildCardHtml(newItem, track.children.length);
    const cardEl = temp.firstElementChild;
    cardEl.classList.add('anim-stagger-1');
    track.appendChild(cardEl);

    handleImageFallbacks(cardEl.querySelector('.catalog-card-poster'));

    // Attach click handler
    cardEl.addEventListener('click', () => {
      launchContentItem(newItem);
    });
track.dataset.sig = Array.from(track.querySelectorAll('.catalog-card[data-item-id]'))
  .map(c => c.getAttribute('data-item-id')).join(',');
    const badge = document.getElementById('cat-count-badge');
    if (badge) {
      badge.textContent = window.t('content_count', { count: track.children.length });
    }
  }

  function buildCardHtml(item, idx) {
    const isRun = currentCategory === 'virtual_run';
    const tagText = isRun ? item.place : item.genre;
    const durationText = window.Utils.formatDuration(item.duration);

    return `
      <div class="catalog-card focusable" data-item-id="${item.id}" tabindex="0">
        <img src="${item.banner}" alt="${window.Utils.escapeHTML(item.title)}" class="catalog-card-poster" loading="lazy" decoding="async" data-candidate-index="0" data-candidates='${JSON.stringify(item.thumbCandidates || [])}' />
        <div class="catalog-card-gradient"></div>
        
        <div class="catalog-card-top-chips">
          ${tagText ? `<span class="badge badge-child">${window.Utils.escapeHTML(tagText)}</span>` : '<span></span>'}
          <span class="badge" style="background: rgba(0,0,0,0.6); color: #fff;">${durationText}</span>
        </div>

        <div class="catalog-card-play-glyph">
          ${window.Utils.getIcon('play')}
        </div>

        <div class="catalog-card-bottom-info">
          <div class="catalog-card-title">${window.Utils.escapeHTML(item.title)}</div>
          <div class="catalog-card-meta">
            <span>${isRun ? 'Virtual Trail' : 'Mat Experience'}</span>
            <span>•</span>
            <span>ID #${item.id}</span>
          </div>
        </div>
      </div>
    `;
  }

  function handleImageFallbacks(imgEl) {
    if (!imgEl) return;

    imgEl.onload = function () {
      // Check if YouTube returned 120px 404 gray placeholder for maxresdefault
      if (imgEl.naturalWidth > 0 && imgEl.naturalWidth <= 120) {
        stepToNextThumbnailCandidate(imgEl);
      }
    };

    imgEl.onerror = function () {
      stepToNextThumbnailCandidate(imgEl);
    };
  }

  function stepToNextThumbnailCandidate(imgEl) {
    try {
      const candidates = JSON.parse(imgEl.getAttribute('data-candidates') || '[]');
      let index = parseInt(imgEl.getAttribute('data-candidate-index') || '0', 10) + 1;

      if (candidates && index < candidates.length) {
        imgEl.setAttribute('data-candidate-index', index);
        imgEl.src = candidates[index];
      } else {
        // Final fallback: gradient artwork SVG
        imgEl.onerror = null;
        imgEl.onload = null;
        imgEl.src = window.Utils.generateFallbackBanner('MatPad', currentCategory);
      }
    } catch (e) {
      imgEl.src = window.Utils.generateFallbackBanner('MatPad', currentCategory);
    }
  }

  function setupCardInteractions(track, items) {
    track.querySelectorAll('.catalog-card').forEach((card, idx) => {
      card.addEventListener('click', () => {
        const id = parseInt(card.getAttribute('data-item-id'), 10);
        const item = items.find(i => i.id === id) || items[idx];
        if (item) {
          launchContentItem(item);
        }
      });
    });
  }

function launchContentItem(item) {
  if (isLaunching) return;
  isLaunching = true;

  if (window.Bridge) window.Bridge.onContentSelected(currentCategory, item);

  if (currentCategory === 'virtual_run') {
    window.Router.navigate('run', { item });
  } else if (window.Notify) {
    window.Notify.show({ type: 'success', title: window.t('content_launching'), message: item.title, duration: 3500 });
  }

  setTimeout(() => { isLaunching = false; }, 1200);
}

  function showEmptyState() {
    const track = document.getElementById('cat-carousel-track');
    const retryBtn = document.getElementById('cat-retry-btn');
    if (!track) return;

    if (retryBtn) retryBtn.style.display = 'inline-flex';

    track.innerHTML = `
      <div class="empty-state-wrap">
        <div class="empty-state-title">${window.t('empty_category')}</div>
        <p class="empty-state-desc">Make sure you have an active network connection or check back later.</p>
      </div>
    `;
  }

  function getDefaultFocus(container) {
    return container.querySelector('.catalog-card') || container.querySelector('#cat-back-btn');
  }

  return {
    onMount,
    getDefaultFocus
  };
})();
