# Hypocampus PDF Downloader

Extension Chrome pour télécharger des fichiers PDF depuis le site web Hypocampus.

## Fonctionnalités

### Téléchargement individuel
- Ajoute un bouton de téléchargement 📥 à côté de chaque PDF
- Télécharge directement le fichier PDF sélectionné
- Fonctionne avec la configuration Chrome habituelle

### Téléchargement multiple (ZIP)
- Bouton "Tout Télécharger (ZIP)" pour télécharger tous les PDFs en une seule fois
- **Résout le problème des multiples fenêtres** : Au lieu de télécharger chaque fichier individuellement (ce qui cause des fenêtres pop-up multiples si Chrome est configuré pour demander l'emplacement), l'extension crée un fichier ZIP unique contenant tous les PDFs
- Contrôles de téléchargement avancés :
  - ⏸ **Pause** : Suspendre le téléchargement à tout moment
  - ▶ **Reprendre** : Continuer le téléchargement depuis où il s'était arrêté
  - ❌ **Annuler** : Arrêter complètement le téléchargement
- Affichage du progrès en temps réel avec estimation du temps restant
- Nommage automatique des fichiers avec horodatage

## Installation

1. Téléchargez les fichiers de l'extension
2. Ouvrez Chrome et allez dans `chrome://extensions/`
3. Activez le "Mode développeur"
4. Cliquez sur "Charger l'extension non empaquetée"
5. Sélectionnez le dossier contenant les fichiers de l'extension

## Utilisation

1. Naviguez vers votre page Hypocampus contenant les PDFs
2. L'extension injecte automatiquement les boutons de téléchargement :
   - **Bouton individuel** (📥) : Télécharge un seul PDF
   - **Bouton "Tout Télécharger (ZIP)"** : Télécharge tous les PDFs dans un ZIP

### Pour le téléchargement multiple :
1. Cliquez sur "Tout Télécharger (ZIP)"
2. L'extension collecte tous les PDFs et les ajoute progressivement au ZIP
3. Utilisez les contrôles pour gérer le téléchargement :
   - **Pause** si vous devez suspendre temporairement
   - **Reprendre** pour continuer
   - **Annuler** pour arrêter complètement
4. Une fois terminé, le fichier ZIP est automatiquement téléchargé

## Avantages de la solution ZIP

- **Un seul téléchargement** : Évite les multiples fenêtres pop-up de Chrome
- **Pas de conflit** : Le téléchargement individuel reste disponible
- **Contrôle total** : Possibilité de pause/reprise/annulation
- **Progression visible** : Indication claire du progrès et du temps restant
- **Organisation** : Tous les fichiers regroupés dans un seul archive

## Fichiers

- `manifest.json` : Configuration de l'extension
- `content.js` : Script injecté dans la page web
- `background.js` : Script de service worker
- `styles.css` : Styles CSS pour l'interface
- `jszip.min.js` : Bibliothèque pour créer des fichiers ZIP
- `popup.html` : Interface popup (optionnel)

## Dépendances

- **JSZip** : Bibliothèque JavaScript pour créer des fichiers ZIP
- **Chrome Extensions API** : Pour les téléchargements et la gestion des données

## Permissions

- `storage` : Pour sauvegarder les tokens d'authentification
- `downloads` : Pour gérer les téléchargements de fichiers
- `cookies` : Pour l'authentification avec l'API Hypocampus

## Résolution du problème original

**Problème** : Quand un utilisateur clique sur "Tout Télécharger" et a configuré Chrome pour demander l'emplacement d'enregistrement, cela créait une fenêtre pop-up pour chaque fichier (avec délais de 2-3 secondes entre chaque).

**Solution** : L'extension crée maintenant un seul fichier ZIP contenant tous les PDFs, résultant en un seul téléchargement avec une seule fenêtre. Le processus est:
1. Collecte progressive des PDFs depuis l'API
2. Ajout de chaque PDF au ZIP en cours
3. Téléchargement final du ZIP complet
4. Possibilité de contrôler le processus (pause/reprise/annulation)

Cette approche élimine complètement le problème des multiples fenêtres tout en offrant une meilleure expérience utilisateur. 