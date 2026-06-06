# Clinica Central — Aplicatie analize

Aplicatie web pentru Clinica Central Pitesti. Permite construirea de **cereri de analize pentru pacienti** (cu CNP) si **explorarea preturilor** din 6 laboratoare: Clinica Sante, Binisan, Derzelius, Medilab, Poliana, Solomed (6.115 analize total). 

## Functionalitati

**Doua tab-uri principale**:

### 1. „Cerere analize" (flow pacient — implicit)
- Introducerea obligatorie a CNP-ului (13 cifre) inainte de orice actiune
- Cautare analize cu sugestii sortate dupa **cel mai mic pret** intai
- Adaugare automata in cerere a variantei celei mai ieftine (din toate cele 6 laboratoare)
- Coș lateral cu preview: laborator, timp executie, eprubeta, cantitate
- Procesare → raport cu:
  - **Pachet optim combinat** (cel mai ieftin pret pentru fiecare analiza)
  - Gruparea pe laboratoare (ca pacientul sa stie unde merge)
  - Pentru fiecare analiza din Sante/Binisan: eprubeta, material biologic, cantitate, unde se trimite, observatii
  - Export **Excel** (cu CNP pacient in fiecare rand + detalii tehnice)
  - Export **JSON** (pentru arhivare/integrare)

### 2. „Explorator preturi" (cautare libera)
- Cautare libera in toate cele 6.115 analize
- Filtrare pe laborator + tab-uri rapide
- Sortare pe coloane (pret, denumire, laborator, timp)
- Card „Cel mai ieftin rezultat" cu butonul info „i" pentru detalii
- Export Excel al tuturor rezultatelor afisate

**Functionalitati comune**:
- Discount-uri ajustabile per laborator (sincronizate intre ambele tab-uri)
- Modal cu detalii tehnice pentru analizele Sante + Binisan (1.633 analize cu detalii complete)
- Design responsive (mobile-friendly)

## Structura proiectului

```
clinica-central/
├── app-source.html           # Aplicatia (devine index.html la deploy)
├── README.md
├── .gitignore
├── .github/workflows/deploy.yml
├── data-source/              # Fisierele Excel sursa
│   └── Sante.xlsx, Binisan.xlsx, etc. (6 fisiere)
├── scripts/
│   ├── build_data.py         # Excel → analize.json
│   ├── labs_config.yaml
│   └── requirements.txt
└── assets/
    ├── css/styles.css
    ├── js/app.js
    ├── img/logo.jpg
    └── data/
        ├── analize.json            # 6.115 analize
        ├── details_sante.json      # 1.183 detalii Sante
        └── details_binisan.json    # 450 detalii Binisan
```

## Setup pe GitHub (pas cu pas)

### Pasul 1 — Creeaza repo-ul

1. Mergi la https://github.com/new
2. **Repository name**: `clinica-central`
3. Alege **Public** (necesar pentru GitHub Pages gratuit)
4. **NU** bifa „Add a README"
5. Click **Create repository**

### Pasul 2 — Urca fisierele

1. Dezarhiveaza `clinica-central-repo.zip` local
2. Pe pagina repo-ului, click pe **uploading an existing file**
3. Drag & drop **tot continutul** folder-ului `clinica-central/`
4. Commit message: „Initial commit" → **Commit changes**

> **Nota**: GitHub ascunde `.github/workflows/deploy.yml`. Daca nu apare in lista urcata, adauga-l manual:
> - **Add file → Create new file**
> - Nume: `.github/workflows/deploy.yml`
> - Lipeste continutul din fisierul local → Commit

### Pasul 3 — Activeaza GitHub Pages

1. **Settings → Pages**
2. La **Source**, selecteaza **GitHub Actions**

### Pasul 4 — Porneste deploy-ul

1. Tab **Actions** (meniul sus)
2. Click pe **„Deploy to GitHub Pages"**
3. Sus-dreapta: **Run workflow → Run workflow**
4. Asteapta ~2 minute

### Pasul 5 — Vezi site-ul

**Settings → Pages** → link-ul din casuta verde (ceva de forma `https://USERNAME.github.io/clinica-central/`)

## Actualizare preturi

**Preturi noi la un laborator existent**:
1. Inlocuieste fisierul Excel din `data-source/` (ex. `Sante.xlsx`)
2. Tab **Actions → Run workflow**
3. ~2 minute si site-ul e actualizat

## Test local

```bash
# Instalare dependinte
pip install -r scripts/requirements.txt

# Genereaza analize.json din Excel-uri
python3 scripts/build_data.py

# Serveste local
python3 -m http.server 8000
# Deschide http://localhost:8000/app-source.html
```

## Cheatsheet

| Vrei sa schimbi...             | Editeaza                                   |
|--------------------------------|--------------------------------------------|
| Preturi / lista analize        | Excel-urile din `data-source/`             |
| Discount-uri default           | `assets/js/app.js` → `DEFAULT_DISCOUNTS`   |
| Design                         | `assets/css/styles.css`                    |
| Logica aplicatiei              | `assets/js/app.js`                         |
| Logo                           | `assets/img/logo.jpg`                      |
| Texte (titluri, descriere)     | `app-source.html`                          |

## Tehnologii
- HTML5 + CSS3 (DM Serif Display + DM Sans)
- JavaScript vanilla
- SheetJS (xlsx export)
- Python + openpyxl (Excel → JSON)
- GitHub Actions + GitHub Pages

## Licenta
Date din listele publice ale laboratoarelor. Verifica intotdeauna preturile direct la laborator inainte de a programa o analiza.
