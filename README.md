# Printable D&D Token Generator

*Read in English below.*  
⬇️ [Versão em Português](#versão-em-português)

---

This project is a Node.js tool designed to **download, process, and generate print-ready PDF sheets of physical tabletop RPG tokens**.

The application automates the creation of physical tokens natively integrated with the **5etools** ecosystem. The workflow includes a book list, downloading images from specific Bestiaries, circular cropping, and automatically organizing PDFs ready for your table's real-world scale (e.g., 1-inch grids), including adding extra copies for lower challenge rating (CR) monsters.

## 🚀 Main Features

- **Full 5etools Integration**: Select a specific book from the 5etools ecosystem via an interactive menu (System Reference Document, Monster Manual, etc.). All data is extracted natively.
- **Smart Circular Cropping (Token Rings)**: Ability to crop base images into a circular format, adding a decorative Border/Ring in Virtual Tabletop (VTT) format (can be solid colors or custom standardized borders from the `rings/` folder).
- **Custom Github Repositories**: To bypass blocks and copyright barriers, the project allows you to configure your own Host or cloned Github repository from which raw data and Tokens should be downloaded.
- **Automatic Normalization**: Standardizes images by cropping and adjusting transparent areas if you manually inject internet artwork into the size folders (`output/images/medias`, `output/images/grandes`, etc).
- **PDF Creation (Size-Based Physical Scale)**: Saves perfectly structured `.pdf` files in the exact dimensions for D&D 5e (Small, Medium, Large, Huge/Gargantuan).

## 🛠️ Installation

1. Make sure you have **Node.js** installed.
2. Clone or download this repository.
3. Install the dependencies:
   ```bash
   npm install
   ```
4. Copy the existing configuration example to set your initial parameters:
   ```bash
   cp config.json.example config.json
   ```

## ⚙️ Configuring `config.json`

The `config.json` file organizes how all PDF, layout, and download engines act in a smart object format:

### `PDF_SETTINGS` (Printing)
- `"DELETE_ON_START"`: Clears the pdf folder on each new generation.
- `"CR_SPECTRUM_MIN" / "CR_SPECTRUM_MAX"`: Controls how Difficulty/CR maps to the number of printed copies. (`"1/8,6"` = a CR 1/8 monster yields 6 replicas per page. Monsters `"12,1"` print only 1 copy).

### `DOWNLOAD_SETTINGS` (Download Sources)
- `"ENABLE_DOWNLOADS"`: Disables remote fetching if you only want to generate the PDF based on your local art.
- `"DELAY_MS"`: Pause in milliseconds to avoid Blocks/Rate Limits for requesting dozens of images rapidly.
- `"USE_5ETOOLS_TOKENS"`: Enables/Disables the 5etools mode of the application.
- `"GITHUB_SRC_REPOSITORY"` / `"GITHUB_IMG_REPOSITORY"`: **Vital Option**. Location from where images should be read. Leave blank (`""`) to use standard open community mirrors, or specify your `https://github.com/YourName/Data` to consume from reliable sources without restriction issues.

### `TOKEN_SIZES` (Physical Scale)
- `"SMALL_IN"`, `"MEDIUM_IN"`, `"LARGE_IN"`, `"HUGE_IN"`: Size in inches printed on the PDF.
- `"SMALL_PX"` to `"HUGE_PX"`: Resolution of images during circular crops of the sharp API.

### `TOKEN_RINGS` (Circular Formatting)
- `"ENABLED"`: Defines whether images should take on a decorated circular outline by default or keep their original square crops.
- `"USE_FROM_RINGS_FOLDER"`: Automatically scans all `.png` files injected by users in the `/rings` folder and uses such custom rings on top of the downloaded original images. If you wish, create borders and paste them into this folder.
- `"COLORS"`: Array of Hex Strings (e.g., `"#000000"`) to define the ring's solid color if no specific Ring exists.

## 🕹️ How to Use

To download monsters from a 5etools repository of your choice, format them graphically, and output them:

```bash
npm start
```
An interactive interface will appear in the terminal asking which 5e book you want to generate physical tokens from for the day. 

> *All processed images are saved as Cache in `output/images/*` so that in future productions they won't be pointlessly downloaded from the internet again!*

## 📁 Directory Structure

- `index.js`: Application entry point.
- `src/`: Isolated logic (Interactive Search system (`inquirer`), PDF manipulation (`pdfkit`), ring converters (`sharp`), and dynamic Github Raw calls).
- `token_images/`: Root folder for raw source assets.
  - `yours/`: Add your manual custom artwork here separated by sizes (`pequenas`, `medias`, `grandes`, `gigantes`).
  - `5etools/`: Automatic caching repository for monsters downloaded from the API to avoid re-downloads.
- `rings/`: Drop area for your own Virtual Ring PNG Masks.
- `output/`: Folder generated after usage. Contains finished assets (`tokens/` branch for processed local PNGs) and final print-ready sheets (`pdf/` branches for both 5etools and manual generation modes).

<br>
<hr>

# Versão em Português

Este projeto é uma ferramenta em Node.js projetada para **baixar, processar e gerar planilhas em PDF prontas para impressão de tokens físicos** para RPGs de mesa.

A aplicação automatiza a criação de tokens em formato físico interligado nativamente com o ecossistema do **5etools**. O fluxo inclui a listagem de livros, o download das imagens de Bestiários específicos, a formatação em círculos, e o arranjo automático de PDFs prontos para a escola real da sua mesa (ex: grids de 1 polegada / 2.5cm), definindo inclusive cópias adicionais para níveis de dificuldade menores (CR).

## 🚀 Funcionalidades Principais

- **Integração Plena do 5etools**: Selecione via menu interativo um livro específico do ecossistema do 5etools (System Reference Document, Monster Manual, etc.). Todos os dados são extraídos nativamente.
- **Formatação Circular Inteligente (Token Rings)**: Capacidade de recortar as imagens de base num formato circular, adicionando uma Borda/Anel decorativo no formato RPG Virtual VTT (podendo ser em cores sólidas ou utilizando bordas padronizadas personalizadas da pasta `rings/`).
- **Repositórios de Github Customizados**: Para contornar bloqueios e barreiras de copyright, o projeto permite que você configure o seu próprio Host ou repositório clone do Github de onde os dados raw e Tokens deverão ser baixados.
- **Normalização Automática**: Padroniza as imagens com cortes e adequação transparente caso você injete artes da internet manualmente nas pastas de tamanho (`output/images/medias`, `output/images/grandes`, etc).
- **Criação de PDF (Escala Físca Baseada em Tamanhos)**: Salva num arquivo `.pdf` perfeitamente estruturado, na dimensão correta para D&D 5e (Small, Medium, Large, Huge/Gargantuan).

## 🛠️ Instalação

1. Certifique-se de ter o **Node.js** instalado.
2. Clone ou baixe este repositório.
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Copie o exemplo de configuração existente para definir seus parâmetros iniciais:
   ```bash
   cp config.json.example config.json
   ```

## ⚙️ Configurando o `config.json`

O arquivo `config.json` organiza a maneira como todas as engrenagens de PDF, layout e download atuam num formato de objeto inteligente:

### `PDF_SETTINGS` (Impressão)
- `"DELETE_ON_START"`: Limpa a pasta pdf a cada nova geração.
- `"CR_SPECTRUM_MIN" / "CR_SPECTRUM_MAX"`: Controla como a Dificuldade/CR mapeia para o número de cópias impressas. (`"1/8,6"` = um monstro CR 1/8 rende 6 réplicas por página. Monstros `"12,1"` imprimem apenas 1 cópia).

### `DOWNLOAD_SETTINGS` (Fontes de Download)
- `"ENABLE_DOWNLOADS"`: Desativa a busca remota caso você só queira gerar o PDF baseado nas suas artes locais.
- `"DELAY_MS"`: Pausa em microssegundos para não tomar Block/Rate Limit por requisitar dezenas de magens rapidamente.
- `"USE_5ETOOLS_TOKENS"`: Ativa/Desativa o modo 5etools do aplicativo.
- `"GITHUB_SRC_REPOSITORY"` / `"GITHUB_IMG_REPOSITORY"`: **Opção Vital**. Local de onde as imagens devem ser lidas. Deixe em branco (`""`) para utilizar os mirrors abertos padrão da comunidade, ou especifique o seu `https://github.com/SeuNome/Dados` para consumir de lugares confiáveis sem problemas de restrição.

### `TOKEN_SIZES` (Escala Física)
- `"SMALL_IN"`, `"MEDIUM_IN"`, `"LARGE_IN"`, `"HUGE_IN"`: Tamanho em polegadas impresso no PDF (ex: `"MEDIUM_IN": 2.56`cm).
- `"SMALL_PX"` a `"HUGE_PX"`: Resolução das imagens durante os recortes circulares da API sharp.

### `TOKEN_RINGS` (Formatação Circular)
- `"ENABLED"`: Define se as imagens devem assumir contorno circular decorado por padrão ou manter recortes quadrados originais.
- `"USE_FROM_RINGS_FOLDER"`: Escaneia automaticamente todos os arquivos `.png` injetados pelos usuários na pasta `/rings` e usa tais anéis customizados sobre as imagens originais baixadas. Caso você queira, crie bordas e cole-ás nesta pasta.
- `"COLORS"`: Array de Strings tipo Hexa (ex: `"#000000"`) para definir a cor lisa do anel em caso de Ring inexistente.

## 🕹️ Como Usar

Para baixar monstros de um repositório 5etools à sua escolha, formatá-los graficamente e produzir na pasta output:

```bash
npm start
```
Uma interface inteligente aparecerá no terminal perguntando de qual livro do 5e você deseja gerar as tokens físicas daquele dia. 

> *Todas as imagens processadas são guardadas como Cache em `output/images/*` para que em produções futuras elas não fiquem sendo baixadas novamente da internet atoa!*

## 📁 Estrutura de Diretórios

- `index.js`: Porta de entrada da aplicação.
- `src/`: Lógicas isoladas (sistema de Busca Interativo (`inquirer`), manipulação de PDF (`pdfkit`), conversores de anéis (`sharp`), e chamadas dinâmicas do Github Raw).
- `token_images/`: Pasta raiz de imagens puras.
  - `yours/`: Solte aqui as suas artes que encontrou internet afora em suas respectivas pastas (`pequenas`, `medias`, `grandes`, `gigantes`).
  - `5etools/`: Cache automático que retém tokens do 5eTools já acessados pela aplicação outrora. 
- `rings/`: Área para dropar suas próprias Máscaras PNG de anéis virtuais.
- `output/`: Respostas prontas para a mesa! Possui brances para seus tokens redimensionados (`tokens/`) assim como os resumos finais em `pdf/` de qualquer um dos fluxos do script.
