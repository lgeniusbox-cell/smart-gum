/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Central Configuration & i18n Translations
 */

window.CONFIG = {
  // Remote Content & Avatars Endpoints
  BASE_URL: 'https://raw.githubusercontent.com/lgeniusbox-cell/matpad-app/refs/heads/main/',
  AVATARS_URL: 'https://raw.githubusercontent.com/lgeniusbox-cell/matpad-app/refs/heads/main/avatars/avatars.json',

  // Category folders on GitHub raw (easily reconfigurable)
  CATEGORIES: {
    GAMES: 'games',
    VIRTUAL_RUN: 'virtual_run'
  },

  // Storage and Cache
  CACHE_VERSION: 1,
  IDB_NAME: 'matpad_tv_db',
  IDB_STORE: 'cache_store',
  FETCH_TIMEOUT_MS: 7000,
  BATCH_SIZE: 3,
  MAX_RETRY_ATTEMPTS: 2,

  // Performance Governor
  PERF_GOVERNOR: {
    SAMPLE_FRAMES: 120, // ~2 seconds at 60fps
    LOW_FPS_THRESHOLD: 38,
    DEFAULT_QUALITY: 'high' // 'high' | 'medium' | 'lite'
  },

  // Profile & Validation Rules
  VALIDATION: {
    NAME_MIN_LENGTH: 1,
    NAME_MAX_LENGTH: 24,
    AGE_MIN: 3,
    AGE_MAX: 100,
    CHILD_AGE_THRESHOLD: 13,
    WEIGHT_MIN: 10,
    WEIGHT_MAX: 250
  },

  // Security / PIN
  PIN: {
    LENGTH: 4,
    MAX_ATTEMPTS: 4,
    LOCKOUT_DURATION_MS: 30000,
    SALT: 'MatPad_TV_Secure_Salt_2026'
  },

  // Navigation Throttling (ms)
  NAV_REPEAT_DELAY: 220,
  NAV_REPEAT_RATE: 130,

  // Default Language
  CURRENT_LANG: 'en',

  // Internationalization Dictionary (EN, FR, AR prepared)
  i18n: {
    en: {
      dir: 'ltr',
      boot_initializing: 'Initializing MatPad Engine...',
      boot_syncing: 'Syncing profile profiles...',
      boot_ready: 'Ready!',
      who_is_playing: 'Who is playing today?',
      select_profile_hint: 'Select your profile or create a new one to begin',
      add_profile: 'Add Profile',
      edit_profile: 'Edit Profile',
      create_profile: 'Create Profile',
      enter_pin_title: 'Enter PIN',
      enter_pin_desc: 'This adult profile is protected by a 4-digit PIN',
      pin_error_incorrect: 'Incorrect PIN. Try again.',
      pin_locked_out: 'Too many attempts. Locked for 30s.',
      name: 'Profile Name',
      enter_name: 'Enter Name',
      age: 'Age',
      weight: 'Weight (kg)',
      sex: 'Sex',
      male: 'Male',
      female: 'Female',
      profile_type: 'Profile Type',
      type_child: 'Child',
      type_adult: 'Adult',
      choose_avatar: 'Choose Avatar',
      set_pin_adult: 'Set 4-Digit PIN (Optional)',
      pin_placeholder: 'PIN (4 digits)',
      confirm_pin: 'Confirm PIN',
      save: 'Save Profile',
      cancel: 'Cancel',
      delete: 'Delete Profile',
      confirm_delete_title: 'Delete this profile?',
      confirm_delete_desc: 'All saved local progress will be lost permanently.',
      confirm_exit_title: 'Exit MatPad TV?',
      confirm_exit_desc: 'Are you sure you want to exit the application?',
      yes_exit: 'Yes, Exit',
      no_stay: 'Cancel',
      games: 'Games',
      games_subtitle: 'Interactive agility, precision & fun challenges',
      virtual_run: 'Virtual Run',
      virtual_run_subtitle: 'Scenic runs across mountains, beaches & cities',
      relax: 'Relax & Breathe',
      relax_subtitle: 'Mindfulness & recovery cooldowns',
      cardio: 'Cardio Session',
      cardio_subtitle: 'High intensity mat intervals & fat burning',
      coming_soon: 'Coming Soon',
      coming_soon_desc: 'This feature will be unlocked in the next update!',
      offline_mode: 'Offline Mode: Displaying cached content',
      content_launching: 'Launching on MatPad...',
      content_count: '{count} Experiences',
      retry: 'Retry Sync',
      empty_category: 'No content available yet. Check back soon!',
      gamepad_connected: 'Gamepad Connected',
      gamepad_disconnected: 'Gamepad Disconnected',
      hint_select: 'Select',
      hint_back: 'Back',
      hint_navigate: 'Navigate',
      hint_settings: 'Settings'
    },
    fr: {
      dir: 'ltr',
      boot_initializing: 'Initialisation du moteur MatPad...',
      boot_syncing: 'Synchronisation des profils...',
      boot_ready: 'Prêt !',
      who_is_playing: 'Qui joue aujourd’hui ?',
      select_profile_hint: 'Sélectionnez votre profil ou créez-en un nouveau',
      add_profile: 'Ajouter Profil',
      edit_profile: 'Modifier Profil',
      create_profile: 'Créer un Profil',
      enter_pin_title: 'Entrez le code PIN',
      enter_pin_desc: 'Ce profil adulte est protégé par un code à 4 chiffres',
      pin_error_incorrect: 'Code PIN incorrect. Réessayez.',
      pin_locked_out: 'Trop de tentatives. Bloqué 30s.',
      name: 'Nom du profil',
      enter_name: 'Entrer le nom',
      age: 'Âge',
      weight: 'Poids (kg)',
      sex: 'Sexe',
      male: 'Masculin',
      female: 'Féminin',
      profile_type: 'Type de profil',
      type_child: 'Enfant',
      type_adult: 'Adulte',
      choose_avatar: 'Choisir un Avatar',
      set_pin_adult: 'Définir un PIN (Facultatif)',
      pin_placeholder: 'PIN (4 chiffres)',
      confirm_pin: 'Confirmer le PIN',
      save: 'Enregistrer',
      cancel: 'Annuler',
      delete: 'Supprimer',
      confirm_delete_title: 'Supprimer ce profil ?',
      confirm_delete_desc: 'Toute votre progression locale sera effacée.',
      confirm_exit_title: 'Quitter MatPad TV ?',
      confirm_exit_desc: 'Êtes-vous sûr de vouloir quitter l’application ?',
      yes_exit: 'Oui, Quitter',
      no_stay: 'Annuler',
      games: 'Jeux',
      games_subtitle: 'Défis interactifs, agilité et précision sur tapis',
      virtual_run: 'Course Virtuelle',
      virtual_run_subtitle: 'Parcours panoramiques en montagne, plage et ville',
      relax: 'Relax & Respiration',
      relax_subtitle: 'Pleine conscience et récupération',
      cardio: 'Session Cardio',
      cardio_subtitle: 'Intervalles haute intensité et brûlage calories',
      coming_soon: 'Bientôt disponible',
      coming_soon_desc: 'Cette fonctionnalité arrive dans la prochaine mise à jour !',
      offline_mode: 'Mode Hors-ligne : Affichage du cache',
      content_launching: 'Lancement sur le MatPad...',
      content_count: '{count} Expériences',
      retry: 'Réessayer',
      empty_category: 'Aucun contenu disponible. Revenez bientôt !',
      gamepad_connected: 'Manette connectée',
      gamepad_disconnected: 'Manette déconnectée',
      hint_select: 'Sélectionner',
      hint_back: 'Retour',
      hint_navigate: 'Naviguer',
      hint_settings: 'Paramètres'
    }
  }
};

window.t = function (key, vars = {}) {
  const lang = window.CONFIG.CURRENT_LANG || 'en';
  const dict = window.CONFIG.i18n[lang] || window.CONFIG.i18n.en;
  let str = dict[key] || window.CONFIG.i18n.en[key] || key;
  for (const k in vars) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
  }
  return str;
};
