/**
 * Photo Gallery Module
 * Displays experiment photos in a grid layout with lightbox viewing functionality
 * Integrates with photo service API and provides thumbnail + full-size viewing
 * Features: Grid layout, lightbox modal, keyboard navigation, download support
 */

class PhotoGallery {
    constructor(containerId, config = {}) {
        this.containerId = containerId;
        this.config = { ...this.getDefaultConfig(), ...config };
        this.state = {
            isLoaded: false,
            isVisible: false,
            experimentId: null,
            photos: [],
            currentPhotoIndex: 0,
            isLightboxOpen: false,
            loadingImages: new Set()
        };
        this.elements = {};
        
        console.log('PhotoGallery initialized');
        this.init();
    }
    
    getDefaultConfig() {
        return {
            apiBaseUrl: '/api',
            autoLoad: true,
            thumbnailSize: 200,
            maxRetries: 3,
            // Supported image formats
            supportedFormats: ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.gif'],
            // Grid settings
            gridColumns: 'auto-fill',
            gridMinWidth: '200px'
        };
    }
    
    async init() {
        try {
            await this.loadTemplate();
            this.bindElements();
            this.attachEvents();
            
            if (this.config.autoLoad && this.config.experimentId) {
                await this.loadExperiment(this.config.experimentId);
            }
            
            this.show();
            console.log('PhotoGallery initialized successfully');
            
        } catch (error) {
            console.error('PhotoGallery initialization failed:', error);
            this.onError(error);
        }
    }
    
    async loadTemplate() {
        // Template should be loaded by app.js and stored in window
        const templateVar = 'PhotoGalleryTemplate';
        if (window[templateVar]) {
            this.template = window[templateVar];
        } else {
            // Fallback: load template directly
            const response = await fetch('/modules/data/photo-gallery/photo-gallery.html');
            if (!response.ok) {
                throw new Error(`Failed to load template: ${response.status}`);
            }
            this.template = await response.text();
        }
        
        this.render();
    }
    
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            throw new Error(`Container element not found: ${this.containerId}`);
        }
        
        container.innerHTML = this.template;
        this.bindElements();
    }
    
    bindElements() {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        
        // Find all elements with data-bind attributes
        const bindableElements = container.querySelectorAll('[data-bind]');
        bindableElements.forEach(el => {
            const bindName = el.dataset.bind;
            this.elements[bindName] = el;
        });
        
        // Verify critical elements exist
        const requiredElements = [
            'photosGrid', 'loadingSpinner', 'errorMessage', 'photosContainer',
            'photoCount', 'totalSize', 'lightboxModal', 'lightboxImage'
        ];
        
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                console.warn(`Required element not found: ${elementName}`);
            }
        }
    }
    
    attachEvents() {
        // Lightbox controls
        if (this.elements.lightboxClose) {
            this.elements.lightboxClose.addEventListener('click', () => this.closeLightbox());
        }
        
        if (this.elements.lightboxPrev) {
            this.elements.lightboxPrev.addEventListener('click', () => this.previousPhoto());
        }
        
        if (this.elements.lightboxNext) {
            this.elements.lightboxNext.addEventListener('click', () => this.nextPhoto());
        }
        
        // Lightbox overlay click to close
        if (this.elements.lightboxModal) {
            const overlay = this.elements.lightboxModal.querySelector('.lightbox-overlay');
            if (overlay) {
                overlay.addEventListener('click', () => this.closeLightbox());
            }
        }
        
        // Keyboard navigation
        document.addEventListener('keydown', (event) => this.handleKeyboard(event));
        
        // Prevent context menu on photos (optional)
        document.addEventListener('contextmenu', (event) => {
            if (event.target.closest('.photo-thumbnail img, .lightbox-photo')) {
                event.preventDefault();
            }
        });
    }
    
    /**
     * Load experiment data (Standard module interface)
     * @param {string} experimentId - Experiment ID
     */
    async loadExperiment(experimentId) {
        try {
            console.log(`Loading photos for experiment: ${experimentId}`);
            
            this.state.experimentId = experimentId;
            this.showLoading();
            
            // Update experiment info in header
            if (this.elements.experimentInfo) {
                this.elements.experimentInfo.textContent = `Experiment: ${experimentId} - Photo Documentation`;
            }
            
            // Load photos metadata
            await this.loadPhotosMetadata();
            
            // Create photo grid
            this.createPhotosGrid();
                      
            this.state.isLoaded = true;
            this.hideLoading();
            
            console.log(`Photo gallery loaded successfully for ${experimentId}: ${this.state.photos.length} photos`);
            
        } catch (error) {
            console.error(`Failed to load experiment ${experimentId}:`, error);
            this.hideLoading();
            this.onError(error);
        }
    }
    
    /**
     * Load photos metadata from API
     */
    async loadPhotosMetadata() {
        try {
            const response = await fetch(
                `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/photos`
            );
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('No photos found for this experiment');
                }
                throw new Error(`Failed to load photos: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load photos');
            }
            
            // Extract photos data from nested response
            const photosData = result.data.photos || result.data.data?.photos || [];
            this.state.photos = photosData;
            
            console.log(`Loaded ${this.state.photos.length} photos:`, this.state.photos.map(p => p.filename));
            
        } catch (error) {
            throw new Error(`Photos metadata loading failed: ${error.message}`);
        }
    }
    
    /**
     * Create photos grid with thumbnails
     */
    createPhotosGrid() {
        if (!this.elements.photosGrid || this.state.photos.length === 0) {
            console.warn('Cannot create photos grid: missing grid element or no photos');
            return;
        }
        
        // Clear existing grid
        this.elements.photosGrid.innerHTML = '';
        
        // Create thumbnail for each photo
        this.state.photos.forEach((photo, index) => {
            const thumbnail = this.createPhotoThumbnail(photo, index);
            this.elements.photosGrid.appendChild(thumbnail);
        });
        
        console.log(`Created photo grid with ${this.state.photos.length} thumbnails`);
    }
    
    /**
     * Create individual photo thumbnail element
     * @param {Object} photo - Photo metadata
     * @param {number} index - Photo index
     * @returns {HTMLElement} Thumbnail element
     */
    createPhotoThumbnail(photo, index) {
        // Create thumbnail container
        const thumbnail = document.createElement('div');
        thumbnail.className = 'photo-thumbnail';
        thumbnail.setAttribute('data-photo-index', index);
        
        // Create image element
        const img = document.createElement('img');
        img.alt = photo.filename;
        img.loading = 'lazy'; // Native lazy loading
        
        // Create loading placeholder
        const loading = document.createElement('div');
        loading.className = 'photo-loading';
        loading.textContent = 'Loading...';
        thumbnail.appendChild(loading);
        
        // Create photo info overlay
        const photoInfo = document.createElement('div');
        photoInfo.className = 'photo-info';
        
        const filename = document.createElement('div');
        filename.className = 'photo-filename';
        filename.textContent = photo.filename;
        filename.title = photo.filename; // Tooltip for long names
        
        const size = document.createElement('div');
        size.className = 'photo-size';
        size.textContent = photo.sizeFormatted || this.formatFileSize(photo.size);
        
        photoInfo.appendChild(filename);
        photoInfo.appendChild(size);
        thumbnail.appendChild(photoInfo);
        
        // Set up image loading
        img.onload = () => {
            loading.remove();
            thumbnail.appendChild(img);
            this.state.loadingImages.delete(photo.filename);
        };
        
        img.onerror = () => {
            loading.textContent = 'Failed to load';
            loading.style.color = 'var(--status-error)';
            console.error(`Failed to load thumbnail: ${photo.filename}`);
        };
        
        // Load thumbnail image
        this.state.loadingImages.add(photo.filename);
        img.src = `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/photos/${photo.filename}`;
        
        // Add click handler to open lightbox
        thumbnail.addEventListener('click', () => {
            this.openLightbox(index);
        });
        
        return thumbnail;
    }
        
    /**
     * Open lightbox at specific photo index
     * @param {number} index - Photo index to display
     */
    openLightbox(index) {
        if (index < 0 || index >= this.state.photos.length) {
            console.warn(`Invalid photo index: ${index}`);
            return;
        }
        
        this.state.currentPhotoIndex = index;
        this.state.isLightboxOpen = true;
        
        // Show lightbox
        if (this.elements.lightboxModal) {
            this.elements.lightboxModal.classList.remove('hidden');
            // Trigger animation
            setTimeout(() => {
                this.elements.lightboxModal.classList.add('active');
            }, 10);
        }
        
        // Load current photo
        this.loadLightboxPhoto(index);
        
        // Update navigation
        this.updateLightboxNavigation();
        
        // Prevent body scrolling
        document.body.style.overflow = 'hidden';
        
        console.log(`Opened lightbox for photo ${index + 1}/${this.state.photos.length}`);
    }
    
    /**
     * Close lightbox
     */
    closeLightbox() {
        this.state.isLightboxOpen = false;
        
        if (this.elements.lightboxModal) {
            this.elements.lightboxModal.classList.remove('active');
            // Hide after animation
            setTimeout(() => {
                this.elements.lightboxModal.classList.add('hidden');
            }, 200);
        }
        
        // Restore body scrolling
        document.body.style.overflow = '';
        
        console.log('Closed lightbox');
    }
    
    /**
     * Navigate to previous photo
     */
    previousPhoto() {
        if (!this.state.isLightboxOpen) return;
        
        const newIndex = this.state.currentPhotoIndex - 1;
        if (newIndex >= 0) {
            this.state.currentPhotoIndex = newIndex;
            this.loadLightboxPhoto(newIndex);
            this.updateLightboxNavigation();
        }
    }
    
    /**
     * Navigate to next photo
     */
    nextPhoto() {
        if (!this.state.isLightboxOpen) return;
        
        const newIndex = this.state.currentPhotoIndex + 1;
        if (newIndex < this.state.photos.length) {
            this.state.currentPhotoIndex = newIndex;
            this.loadLightboxPhoto(newIndex);
            this.updateLightboxNavigation();
        }
    }
    
    /**
     * Load photo in lightbox
     * @param {number} index - Photo index to load
     */
    loadLightboxPhoto(index) {
        const photo = this.state.photos[index];
        if (!photo) return;
        
        // Show loading state
        if (this.elements.lightboxLoading) {
            this.elements.lightboxLoading.classList.remove('hidden');
        }
        
        // Update photo info
        if (this.elements.lightboxTitle) {
            this.elements.lightboxTitle.textContent = photo.filename;
        }
        
        if (this.elements.lightboxMeta) {
            const meta = `${photo.sizeFormatted || this.formatFileSize(photo.size)} • ${photo.type}`;
            this.elements.lightboxMeta.textContent = meta;
        }
        
        // Update counter
        if (this.elements.lightboxCounter) {
            this.elements.lightboxCounter.textContent = `${index + 1} of ${this.state.photos.length}`;
        }
        
        // Load full-size image
        if (this.elements.lightboxImage) {
            const img = this.elements.lightboxImage;
            
            img.onload = () => {
                if (this.elements.lightboxLoading) {
                    this.elements.lightboxLoading.classList.add('hidden');
                }
                console.log(`Loaded lightbox photo: ${photo.filename}`);
            };
            
            img.onerror = () => {
                if (this.elements.lightboxLoading) {
                    this.elements.lightboxLoading.innerHTML = '<p style="color: var(--status-error);">Failed to load full-size image</p>';
                }
                console.error(`Failed to load lightbox photo: ${photo.filename}`);
            };
            
            // Set image source
            img.src = `${this.config.apiBaseUrl}/experiments/${this.state.experimentId}/photos/${photo.filename}`;
            img.alt = photo.filename;
        }
    }
    
    /**
     * Update lightbox navigation buttons
     */
    updateLightboxNavigation() {
        const isFirst = this.state.currentPhotoIndex === 0;
        const isLast = this.state.currentPhotoIndex === this.state.photos.length - 1;
        
        if (this.elements.lightboxPrev) {
            this.elements.lightboxPrev.disabled = isFirst;
        }
        
        if (this.elements.lightboxNext) {
            this.elements.lightboxNext.disabled = isLast;
        }
    }
        
    /**
     * Handle keyboard navigation
     * @param {KeyboardEvent} event - Keyboard event
     */
    handleKeyboard(event) {
        if (!this.state.isLightboxOpen) return;
        
        switch (event.key) {
            case 'Escape':
                this.closeLightbox();
                event.preventDefault();
                break;
            case 'ArrowLeft':
                this.previousPhoto();
                event.preventDefault();
                break;
            case 'ArrowRight':
                this.nextPhoto();
                event.preventDefault();
                break;
            case ' ': // Spacebar
                this.nextPhoto();
                event.preventDefault();
                break;
        }
    }
    
    /**
     * Format file size in human readable format
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted size string
     */
    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = bytes / Math.pow(1024, i);
        
        return Math.round(size * 100) / 100 + ' ' + sizes[i];
    }
    
    // === STATE MANAGEMENT ===
    
    showLoading() {
        this.hideError();
        this.hidePhotos();
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.remove('hidden');
        }
    }
    
    hideLoading() {
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.add('hidden');
        }
    }
    
    showError(message) {
        this.hideLoading();
        this.hidePhotos();
        
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.remove('hidden');
        }
        if (this.elements.errorText) {
            this.elements.errorText.textContent = message;
        }
    }
    
    hideError() {
        if (this.elements.errorMessage) {
            this.elements.errorMessage.classList.add('hidden');
        }
    }
    
    showPhotos() {
        this.hideLoading();
        this.hideError();
        
        if (this.elements.photosContainer) {
            this.elements.photosContainer.classList.remove('hidden');
        }
    }
    
    hidePhotos() {
        if (this.elements.photosContainer) {
            this.elements.photosContainer.classList.add('hidden');
        }
    }
    
    onError(error) {
        const message = error.message || 'Failed to load photos';
        this.showError(message);
        
        // Emit error event
        this.emit('error', {
            moduleName: 'photo-gallery',
            message: message,
            recoverable: true
        });
    }
    
    // === EVENT EMISSION ===
    
    emit(eventName, data) {
        const fullEventName = `module:photo-gallery:${eventName}`;
        const event = new CustomEvent(fullEventName, {
            detail: data,
            bubbles: true
        });
        document.dispatchEvent(event);
    }
    
    // === PUBLIC INTERFACE (Standard Module Methods) ===
    
    show() {
        this.state.isVisible = true;
        const container = document.getElementById(this.containerId);
        if (container) {
            container.style.display = 'block';
        }
        
        // Show photos if loaded
        if (this.state.isLoaded && this.state.photos.length > 0) {
            this.showPhotos();
        }
    }
    
    hide() {
        this.state.isVisible = false;
        const container = document.getElementById(this.containerId);
        if (container) {
            container.style.display = 'none';
        }
        
        // Close lightbox if open
        if (this.state.isLightboxOpen) {
            this.closeLightbox();
        }
    }
    
    destroy() {
        // Close lightbox
        if (this.state.isLightboxOpen) {
            this.closeLightbox();
        }
        
        // Remove event listeners
        document.removeEventListener('keydown', this.handleKeyboard);
        
        // Clear container
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        // Clear state
        this.state = {};
        this.elements = {};
        
        console.log('PhotoGallery destroyed');
    }
    
    getState() {
        return {
            ...this.state,
            config: this.config
        };
    }
    
    // === PHOTO-SPECIFIC METHODS ===
    
    /**
     * Get current photo count
     * @returns {number} Number of photos
     */
    getPhotoCount() {
        return this.state.photos.length;
    }
    
    /**
     * Get total file size of all photos
     * @returns {number} Total size in bytes
     */
    getTotalSize() {
        return this.state.photos.reduce((sum, photo) => sum + photo.size, 0);
    }
    
    /**
     * Get photo by filename
     * @param {string} filename - Photo filename
     * @returns {Object|null} Photo metadata
     */
    getPhotoByFilename(filename) {
        return this.state.photos.find(photo => photo.filename === filename) || null;
    }
    
    /**
     * Refresh photos (reload from API)
     * @returns {Promise<void>}
     */
    async refreshPhotos() {
        if (this.state.experimentId) {
            console.log('Refreshing photos...');
            await this.loadExperiment(this.state.experimentId);
        }
    }
}

// Export for global access
window.PhotoGallery = PhotoGallery;