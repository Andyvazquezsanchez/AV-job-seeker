# Manual completo de Job Seeker

Job Seeker automatiza la parte repetitiva de una búsqueda laboral: busca avisos según tus criterios, completa formularios con tus datos, lleva el registro de todo y te deja la decisión donde importa. Funciona en tu computadora, con un panel de botones en el navegador. No necesita cuentas, servidores ni conocimientos técnicos.

Job Seeker fue desarrollado por Andy Vázquez Sánchez (https://www.linkedin.com/in/avazquezsanchez), a partir del proyecto de código abierto [job-seeker](https://github.com/galiprandi/job-seeker) de Germán Aliprandi, que tiene licencia MIT. Job Seeker es gratuito para uso personal y **está prohibido venderlo** o usarlo con fines comerciales sin permiso del autor: las partes creadas por Andy Vázquez Sánchez tienen licencia PolyForm Noncommercial 1.0.0 (ver `LICENSE`). El programa no trae datos de ninguna persona: cada usuario carga los suyos.

Este es el manual completo, para consultar. Si es tu primera vez, empezá por el manual corto **"Cómo comenzar"** (`Job-Seeker-Como-comenzar.pdf`): tiene lo indispensable en pocas páginas. Todo lo marcado como **opcional** se puede saltear.

## Índice

1. Qué hace y qué no hace
2. Qué necesitás
3. Instalación
4. El panel
5. Tu configuración
6. Cargar tu información sin tipear
7. Tu planilla de seguimiento (opcional)
8. Uso diario, con ejemplos
9. Ritmo y límites
10. Uso avanzado con un agente de IA (opcional)
11. Seguridad y privacidad
12. Si lo va a usar otra persona
13. Problemas frecuentes
14. Referencia de comandos
15. Qué está probado y qué no
16. Gracias

## 1. Qué hace y qué no hace

Hace:

- Busca en LinkedIn con tus puestos objetivo, tus palabras a evitar y tus búsquedas con booleanos.
- Postula solo a los avisos con Solicitud sencilla (Easy Apply), respondiendo con datos que vos cargaste.
- Los avisos que llevan al sitio de la empresa (botón "Solicitar") no los envía: los filtra igual y te los deja en **Avisos para revisar**, para que te postules vos o, si instalaste el agente de IA (opcional), se los pases a él.
- No repite: antes de cada corrida lee tu planilla de seguimiento (si tenés una) y compara cada aviso con todo lo que ya postulaste o descartaste, por link y por empresa y puesto, aunque estén escritos distinto.
- Anota cada postulación que envía en un archivo que se abre con Excel.
- Con un agente de IA (uso avanzado): prepara postulaciones en páginas de empresas, con una cola para tu aprobación, y redacta correos y mensajes que solo salen cuando aprobás cada uno.

No hace:

- No inventa respuestas. Si un formulario pregunta algo que no cargaste, cierra sin enviar y te muestra la pregunta.
- No modifica tu planilla de seguimiento. Solo la lee.
- No se actualiza solo ni descarga código al ejecutarse.
- No resuelve captchas ni inicia sesión por vos. Tu contraseña de LinkedIn la escribís vos en la ventana de Chrome; el programa no la ve ni la guarda.
- No envía tus datos a nadie más que a los sitios donde postulás.

## 2. Qué necesitás

| Requisito | Para qué |
|---|---|
| Windows 10 u 11 (también funciona en macOS y Linux) | |
| Google Chrome | Navegar y postular |
| Cuenta de LinkedIn | Donde vas a postular |

Nada más. El paquete para Windows trae incluido todo lo que el programa necesita para funcionar (el motor Node.js oficial y sus componentes) y la base de datos se crea sola: es una carpeta llamada `datos` dentro de la carpeta del programa.

Un agente de IA de programación (Claude Code u otro que lea `AGENTS.md`) es opcional: sirve para postular en páginas de empresas, evaluar avisos y redactar mensajes.

## 3. Instalación

### Windows

1. Descomprimí el archivo `JobSeeker-Windows.zip` en un lugar fijo, por ejemplo dentro de Documentos. Clic derecho sobre el .zip, "Extraer todo". No lo ejecutes desde adentro del .zip.
2. Entrá a la carpeta `JobSeeker` y hacé doble clic en `Instalar.bat`.
3. Se abre una ventana negra que verifica todo, crea la base de datos, deja un acceso directo **Job Seeker** en el Escritorio y abre el panel en tu navegador.

Desde ese momento, para usar el programa abrís el acceso directo del Escritorio.

Si Windows muestra un cartel azul que dice "Windows protegió su PC": elegí "Más información" y después "Ejecutar de todas formas". Aparece con cualquier archivo `.bat` que llegó desde internet. `Instalar.bat` es un archivo de texto: lo podés abrir con el Bloc de notas y leerlo antes de ejecutarlo.

Mientras usás el programa queda abierta una ventana negra minimizada. Es el programa funcionando: para cerrarlo, cerrá esa ventana.

### macOS y Linux

Hace falta Node.js 22 o superior (https://nodejs.org). En una terminal, dentro de la carpeta:

```bash
sh instalar.sh     # una vez
sh abrir.sh        # cada vez que lo uses
```

### Dónde quedan tus datos

Todo queda dentro de la carpeta del programa:

| Carpeta o archivo | Qué tiene |
|---|---|
| `datos` | Tu base de datos (perfil, respuestas, postulaciones) y el registro `postulaciones-automaticas.csv` |
| `config` | Archivos que quieras importar o exportar |
| `.browser-profile` | La sesión de LinkedIn de la ventana de Chrome del programa |

Copia de seguridad: copiá la carpeta `datos` con el programa cerrado. Desinstalar: borrá la carpeta del programa y el acceso directo.

### Es posible usar una planilla de Google, un Excel o un CSV como base de datos?

Como almacenamiento principal, no conviene: Google Sheets obliga a crear credenciales en Google Cloud (más complicado que cualquier base de datos), y un Excel o un CSV se bloquean cuando están abiertos y no soportan que el programa lea y escriba mientras vos lo mirás. Por eso el programa usa un archivo local que se crea solo, y trabaja con planillas de la forma que sí es segura: **lee** tu Excel o CSV de seguimiento, **importa** historial desde Excel, CSV o JSON, y **exporta** todo a CSV para abrirlo con Excel.

## 4. El panel

El panel se abre en tu navegador (dirección `http://localhost:7531`) y solo funciona desde tu computadora. Arriba muestra el estado: si tus datos están cargados, si encontró Chrome, si tu planilla está conectada, cuántas preguntas esperan respuesta y cuántas postulaciones van hoy respecto del tope.

| Botón | Qué hace |
|---|---|
| 1. Abrir configuración (necesario) | Cargar tus datos, qué buscás y tus respuestas (sección 5). Obligatorio: nombre, email y puestos objetivo |
| 2. Iniciar sesión en LinkedIn (necesario) | Abre una ventana de Chrome propia del programa, separada de tu Chrome de todos los días. Iniciás sesión ahí una sola vez |
| 3. Simular (recomendado) | Busca avisos y muestra a cuáles se postularía y cuáles descarta, con el motivo. No envía nada |
| 4. Postular ahora | Envía postulaciones reales a los avisos con Solicitud sencilla. Los que llevan al sitio de la empresa quedan en Avisos para revisar. Pide una confirmación extra antes de empezar |
| 5. Postulación automática (opcional) | Programa en Windows los días y horarios en que el programa se postula solo (abajo) |
| 6. Leer planilla ahora (opcional) | Solo si llevás tu propio Excel o CSV: lo lee para no repetir avisos (sección 7) |
| 7. Exportar (opcional) | Descarga tu configuración (`perfil.json`) o todas las postulaciones (`postulaciones.csv`) |

Abajo, en **Actividad**, se ve en vivo lo que está haciendo, con un botón **Detener**. Las pestañas de arriba llevan a **Configuración** y a **Seguimiento** (un tablero con tus postulaciones por etapa).

Orden recomendado la primera vez: 1, 2, 3. Mirá bien el resultado de la simulación, ajustá los filtros y recién después usá el 4 con pocas postulaciones.

## 5. Tu configuración

Lo mínimo para empezar: tu nombre, tu email y los puestos que buscás. Todo lo demás mejora los resultados pero se puede completar de a poco.

Hay tres formas de arrancar, y se pueden combinar:

- **Plantillas por área.** La primera vez, "Qué buscás" viene cargado con términos de ejemplo de Recursos Humanos. Arriba de esa sección hay botones para cambiar a otra área (Administración y finanzas, Tecnología, Comercial y ventas, Marketing y comunicación, Atención al cliente y operaciones) o **Vaciar**. Cada plantilla llena puestos, palabras a evitar, frases a evitar y búsquedas; después se editan como cualquier campo. Nada se guarda hasta tocar **Guardar**.
- **Asistente con preguntas** (`/asistente`, también desde el Panel). Diez pasos: tu CV (opcional), tus datos, el área, los puestos (con variantes de liderazgo), el nivel, dónde y cómo querés trabajar, condiciones, lo que no querés y un texto libre. Si pegás el CV, detecta tus datos de contacto y sugiere el área. Al final muestra un resumen y guarda.
- **Con tu IA** (sección "Cargar sin tipear"). Ver el capítulo 6.

### Qué buscás

| Campo | Qué poner | Ejemplo |
|---|---|---|
| Puestos objetivo | Palabras o frases que el título del aviso debe contener. Una por línea, en cada idioma en que busques. Sin esto, la postulación automática no arranca | `analista contable`, `accountant`, `tesorería` |
| Palabras que descartan por título | Si el título contiene alguna, el aviso se descarta | `pasante`, `ventas` |
| Frases que descartan por descripción | Igual, pero mirando el texto del aviso | `solo comisiones`, `disponibilidad para rotar turnos` |
| Búsquedas para LinkedIn | Búsquedas completas con booleanos. En cada corrida se usan todas y se juntan los avisos | ver abajo |
| Modalidad | Remoto, híbrido, presencial. Sin marcar, no filtra | |
| Antigüedad máxima del aviso | Último día, semana o mes | |
| Ubicación de búsqueda | País o ciudad | `Argentina` |
| Lugares aceptados para avisos presenciales o híbridos | Uno por línea. Un aviso presencial o híbrido pasa solo si su lugar (lo que está antes de la primera coma) coincide con alguno. Los remotos pasan siempre | `buenos aires`, `caba`, `san isidro` |
| Palabras del título que solo valen en puestos senior | Un aviso con esas palabras pasa solo si el título también dice Senior o Sr (Semi Senior y Ssr no cuentan) | `analista`, `analyst` |
| Salario mínimo en USD / en pesos | Bruto por mes. Si el aviso publica un salario y su máximo queda debajo, se descarta. Si no publica salario, no se descarta. Un salario anual se divide por 12; uno por hora se multiplica por 160 | `2000` |
| Afinidad mínima para postular (opcional) | De 0 a 100. Los avisos con menos no se postulan. Vacío o 0: no filtra | `55` |
| Páginas de empleo de empresas (opcional) | Direcciones de Greenhouse, Lever o Ashby de empresas que te interesan, una por línea (sección 8, "Otras fuentes de avisos") | `https://jobs.lever.co/empresa` |
| Otros portales donde buscar (opcional) | computrabajo, bumeran, zonajobs. Vacío = los tres | `computrabajo` |

Las coincidencias ignoran mayúsculas y tildes, y son por palabra completa: `people` no coincide con `Peoplesoft`.

**Búsquedas con booleanos.** LinkedIn acepta `AND`, `OR`, `NOT`, comillas para frases exactas y paréntesis:

```
("Analista Contable" OR "Contador Senior") NOT (pasante OR trainee)
("Project Manager" OR "Jefe de Proyecto") AND (construcción OR obra)
"Customer Success" AND (SaaS OR software)
```

La búsqueda trae avisos; el filtro de puestos objetivo decide a cuáles se postula. Conviene que la búsqueda sea amplia y el filtro, estricto.

### Empresas

- **Empresas a evitar:** nunca se postula a ellas.
- **Empresas objetivo:** las que te interesan aunque no tengan aviso abierto. Las usa el agente en el flujo `targets`.
- **Tipos de empresa preferidos o a evitar** y **condiciones excluyentes:** texto libre que el agente tiene en cuenta al evaluar cada aviso.

### Tus datos y las respuestas para formularios

Los formularios se responden únicamente con lo que figure acá:

- Nombre, correo, teléfono, ciudad, país, LinkedIn.
- Años de experiencia totales.
- **Años de experiencia por tema:** una fila por tema. La pregunta "cuántos años de experiencia tenés en X" se responde solo si X está en la lista.

  | Tema | Años |
  |---|---|
  | conciliaciones bancarias | 6 |
  | SAP | 4 |
  | liderazgo de equipos | 3 |

- Nivel de idiomas, disponibilidad, universidad, título.
- **Pretensión salarial:** por moneda. Si dejás vacía una moneda, las preguntas de sueldo en esa moneda quedan pendientes y te consulta cada vez.
- **Banco de respuestas:** la pregunta tal como la escribió el formulario y tu respuesta. Se va llenando solo a medida que respondés las pendientes.

### Preguntas pendientes

Cuando un formulario pregunta algo sin respuesta cargada, la postulación se cierra sin enviar y la pregunta aparece arriba de todo en la página de configuración, con sus opciones y la cantidad de postulaciones que está frenando. Respondés una vez y queda guardada para siempre.

### CV para cada aviso

En la Solicitud sencilla, LinkedIn pide elegir uno de los CV que tenés guardados. El programa elige solo, aviso por aviso:

| Situación | CV que usa |
|---|---|
| Una de tus reglas propias coincide con el título o la descripción | El de la regla |
| La descripción está en inglés | Inglés |
| La descripción está en otro idioma (portugués, alemán...) | Inglés |
| La descripción está en español | Español |
| No se puede saber por la descripción y el puesto es fuera de países de habla hispana | Inglés |
| No se puede saber y el puesto es en un país de habla hispana, o no hay datos | Español |

Qué cargar en Configuración, sección **CV para cada aviso**:

- **CV en español** y **CV en inglés:** la ruta del PDF de cada uno en tu computadora. Ejemplo en Windows: `C:\Users\tu-usuario\Documents\CV_EN.pdf`. El nombre del archivo tiene que ser el mismo con el que lo subiste a LinkedIn: así lo encuentra entre tus CV guardados.
- **Reglas propias** (opcional): `palabras del aviso = CV`. Ejemplo: `recruiter it = CV_IT.pdf`. Van antes que la regla del idioma.
- **Foto de perfil** (opcional): la ruta de una imagen JPG o PNG de hasta 5 MB. Algunos formularios de empresas piden foto; el agente sube esta. Sin foto cargada, esas postulaciones quedan esperando tu aprobación con el motivo.

Cómo actúa en el formulario:

1. Busca el CV por nombre entre los guardados en LinkedIn (abre "Mostrar más" si hace falta) y lo marca.
2. Si LinkedIn no lo tiene guardado (LinkedIn conserva solo los últimos), lo sube desde tu computadora.
3. Antes de enviar revisa la pantalla final: si figura otro CV, o no puede confirmar el correcto, **no envía** y te dice por qué ("NO SE ENVIÓ POR EL CV").

Si no cargás ningún CV, se usa el que LinkedIn tenga marcado. La simulación muestra qué CV usaría en cada aviso, y el registro `postulaciones-automaticas.csv` anota cuál se envió.

### Texto del CV y contexto

- **Texto del CV** y **Contexto:** texto libre o Markdown. El agente lo lee para armar tu perfil y redactar con tu estilo.
- El **Texto del CV** también sirve para la afinidad y las palabras clave de cada aviso (sección 8, "Afinidad, palabras clave y CV adaptado"). Pegá el texto completo de tu CV. El programa nunca lo modifica.

## 6. Cargar tu información sin tipear

Arriba de todo en la página de Configuración está la sección **Cargar sin tipear**:

- **Pegar texto.** Pegá el texto de tu CV, tu firma de mail o una lista del tipo `Teléfono: ...` y tocá **Detectar mis datos**. Detecta nombre, email, teléfono y LinkedIn (y ciudad, país, nivel de inglés y otros si vienen con su etiqueta) y los vuelca en los campos para que los revises. No pisa lo que ya estaba cargado y no guarda nada hasta que toques **Guardar**.
- **Usar este texto como CV.** Copia lo pegado al campo "Texto del CV".
- **Leer CV desde archivo.** Acepta `.docx` y `.txt`. Para un PDF: abrilo, seleccioná todo (Ctrl+A), copiá (Ctrl+C) y pegalo en el cuadro.
- **Perfil (perfil.json).** Carga toda una configuración de una vez.
- **Historial de postulaciones.** Acepta `.xlsx`, `.csv` o `.json`. En Excel o CSV busca sola la tabla: alcanza con que tenga una columna de empresa y una de puesto (y, si existen, estado, fecha, link y notas).
- **Informe de contexto.** Un `.md`, `.txt` o `.docx` con tus preferencias, sueldos pedidos o cartas modelo.

### Con tu IA (ChatGPT, Gemini, Claude, Copilot u otra)

Para quien no tiene un `perfil.json` y prefiere armar todo conversando con la IA que ya usa:

1. **Copiar instrucciones para mi IA.** Copia un texto con las instrucciones y la lista de campos. Si pegaste tu CV en el cuadro de arriba (o ya está guardado), va incluido.
2. Pegalo en el chat de tu IA. Te va a hacer preguntas sobre lo que buscás; respondelas ahí.
3. Cuando te devuelva el JSON, pegalo en **"Pegá acá la respuesta de tu IA"** y tocá **Cargar respuesta**. Los campos se completan para que los revises; nada se guarda hasta tocar **Guardar**. Las claves desconocidas se ignoran y los valores se controlan igual que en cualquier importación.

En **Preguntas pendientes** hay lo mismo para las preguntas de formularios: **Pedirle a mi IA que sugiera respuestas** copia las preguntas (con sus opciones, tu CV y tu contexto); pegás su respuesta y se completan los campos para revisar.

Para las rutas de archivos (CV en PDF, planilla): en Windows, clic derecho sobre el archivo, "Copiar como ruta de acceso", y pegar. Las comillas se quitan solas.

Los mismos archivos se pueden dejar en la carpeta `config` antes de instalar (`perfil.json`, `historial.json` y un `.md`): el instalador los importa solo.

### `config/perfil.json`: tu configuración

Hay un ejemplo en `config/perfil.ejemplo.json`. Uno mínimo:

```json
{
  "first_name": "Nombre",
  "last_name": "Paz",
  "email": "nombre@example.com",
  "target_titles": ["analista contable", "accountant"],
  "avoid": ["pasante"],
  "search_queries": ["(\"Analista Contable\" OR Accountant) NOT (pasante OR trainee)"],
  "work_modes": ["remote", "hybrid"],
  "posted_within": "week",
  "search_location": "Argentina",
  "years_of_experience": "8",
  "experience_years": { "conciliaciones bancarias": "6", "SAP": "4" },
  "english_level": "B2",
  "salary_ars": "2500000"
}
```

```bash
node scripts/config.js import --dry-run   # revisa sin guardar
node scripts/config.js import             # guarda
```

Las claves que no existen se informan y se ignoran. Lo que no incluyas en el archivo queda como estaba.

### `config/historial.json`: lo que ya postulaste

Para que no repita. Una fila por postulación; `company` y `role` son obligatorios:

```json
[
  { "company": "Acme", "role": "Analista Contable Sr", "status": "applied", "date": "2026-10-21" },
  { "company": "Globex", "role": "Accountant", "status": "rejected", "url": "https://..." },
  { "company": "Initech", "role": "Tesorero", "status": "skipped" }
]
```

Estados válidos: `applied`, `contacted`, `in_review`, `screening`, `interview`, `offer`, `hired`, `rejected`, `withdrawn`, `skipped` (lo descartaste y no querés que postule).

```bash
node scripts/config.js history
```

Se puede correr varias veces: lo que ya está no se duplica.

### Un informe en Markdown

Cualquier archivo `.md` o `.txt` con tus preferencias, tu forma de escribir, sueldos pedidos o cartas modelo:

```bash
node scripts/config.js context --file config/mi-contexto.md
```

**Cómo generarlo con un asistente que ya te conoce.** Si venís trabajando tu búsqueda en un chat (Claude u otro), pedile algo así:

> Armame tres archivos con lo que sabés de mi búsqueda laboral, solo con información mía: (1) un `perfil.json` con estas claves: target_titles, avoid, description_avoid, search_queries, work_modes, posted_within, search_location, years_of_experience, experience_years, english_level, salary_ars, salary_usd; (2) un `historial.json` con las empresas y puestos a los que ya me postulé o descarté, con company, role, status y date; (3) un informe en Markdown con mi perfil, qué busco, qué descarto, sueldos que pedí y cómo quiero que se redacten mis mensajes. No inventes datos: lo que no sepas, dejalo vacío.

Revisá los tres antes de importarlos. Son un punto de partida, no una verdad.

## 7. Tu planilla de seguimiento (opcional)

Si no tenés planilla, no hace falta crear una: el programa anota todo lo que envía y lo ves en **Seguimiento** o con **Exportar**.

Si ya llevás un Excel o un CSV con tus postulaciones, conectalo: en Configuración, sección **Seguimiento**, pegá la ruta del archivo.

Qué pasa después:

- Antes de cada simulación o postulación, el programa **lee** la planilla y suma lo que no conocía: postulaciones, rechazos y avisos descartados. Así no se postula a algo que ya enviaste por otro medio ni a algo que decidiste no enviar.
- Reconoce la misma empresa y el mismo puesto aunque estén escritos distinto ("Empresa Uno S.R.L." y "EmpresaUno"; mayúsculas, tildes y formas societarias no cuentan).
- Si la planilla dice que una postulación avanzó o fue rechazada, actualiza el estado en el programa. Nunca retrocede un estado.
- Lee todas las hojas que tengan una tabla con columnas de empresa y puesto. Una hoja cuyo nombre contenga "Descartes" se toma como avisos a no postular; una que contenga "Rechazos", como rechazadas.
- **Nunca escribe en tu planilla.** Funciona aunque la tengas abierta en Excel.

En el sentido inverso, cada postulación que el programa envía se anota en un archivo aparte, `postulaciones-automaticas.csv`, con fecha, hora, empresa, puesto, canal y link. Por defecto queda en la carpeta `datos`; en Configuración podés elegir otra ubicación, por ejemplo la misma carpeta de tu planilla. Se abre con Excel. Si lo tenés abierto en el momento de anotar, la fila va a `postulaciones-automaticas-pendiente.csv` para no perderla.

Ejemplo: tu planilla está en `C:\Users\usuario\Documents\Busqueda\Seguimiento.xlsx`. La conectás y elegís como registro `C:\Users\usuario\Documents\Busqueda\postulaciones-automaticas.csv`. Vos seguís cargando en tu planilla lo que postulás a mano; el programa lo lee antes de cada corrida, y lo que postula él queda en el registro, listo para copiar a tu planilla.

## 8. Uso diario, con ejemplos

### Ver qué haría, sin postular

Botón **Simular**. Ejemplo de resultado:

```
Planilla de seguimiento: 403 filas leídas, 2 nuevas, 1 actualizadas.
Búsqueda: ("HR Business Partner" OR HRBP OR "People Partner")
Ubicación: Argentina

Descartados por tus filtros o porque ya te postulaste (3):
  - Pasante de RRHH en Acme [el título contiene "pasante"]
  - HR Business Partner en Globex [ya te postulaste: Globex S.A. / HRBP (applied)]
  - Vendedor en Initech [el título no coincide con tus puestos objetivo]

Simulación: me postularía a estos 4 (no envié nada):

1. People Partner en Umbrella
   CV: CV_EN.pdf (el aviso está en inglés)
   Afinidad: 74/100 (puesto 30/30, palabras clave 24/40, nivel y experiencia 10/10, lugar y modalidad 10/10, idioma 10/10)
   En tu CV con otras palabras: "onboarding" (tu CV: Inducción); "KPIs" (tu CV: métricas)
   No aparecen en tu CV: HRBP, Workday, relaciones laborales
...
```

La simulación abre cada aviso (sin tocar nada) para aplicar los mismos controles que una postulación real: si ya te postulaste, empresas y frases a evitar, qué CV usaría y la afinidad. Usala para ajustar puestos objetivo y palabras a evitar antes de postular en serio.

### Afinidad, palabras clave y CV adaptado

Cada aviso cuya descripción se leyó recibe una **afinidad** de 0 a 100. Se arma con cinco partes: puesto (30), palabras clave (40), nivel y experiencia (10), lugar y modalidad (10) e idioma (10). La ves en la simulación, en **Avisos para revisar** (con la opción de ordenar por afinidad) y en **Seguimiento**.

Las **palabras clave** son los términos que el aviso pide, comparados con el texto de tu CV, en tres grupos:

- **Ya están en tu CV.**
- **Están en tu CV, pero con otras palabras:** por ejemplo, el aviso dice "onboarding" y tu CV dice "inducción". Si es lo mismo, conviene usar la palabra exacta del aviso, porque muchos filtros automáticos (ATS) buscan el término literal.
- **No aparecen en tu CV.** Marcá las que de verdad tenés. El programa nunca le agrega nada a tu CV.

Con eso tenés dos botones:

- **Copiar instrucciones para tu IA: CV adaptado.** Copia un pedido para la IA que uses (ChatGPT, Gemini, Claude, Copilot) con el aviso, tu CV, las equivalencias y lo que marcaste. Las reglas del pedido son estrictas: no inventar experiencia, usar la palabra del aviso solo para lo que ya está en tu CV, mantener fechas y empresas, formato simple para ATS y listar aparte lo que no tenés.
- **Copiar línea de competencias:** una línea para tu CV con las palabras del aviso que sí tenés.

En el **detalle** de una postulación (Seguimiento) tenés además **Copiar pedido para preparar la entrevista**: tu IA recibe el aviso y tu CV y te arma las preguntas probables, respuestas con ejemplos de tu experiencia, cómo hablar de lo que te falta y preguntas para hacerle a la empresa, sin inventar nada. Y en Avisos para revisar, **Postularme con mi IA** copia un pedido para que tu IA te ayude a completar el formulario de la empresa con tus respuestas guardadas: vos le pegás las preguntas y ella las responde solo con tus datos y tu CV, y te pregunta lo que falte. Ese pedido incluye tus datos de contacto y tus respuestas: revisalo antes de pegarlo.

Ejemplo de uso: en Avisos para revisar ordenás por afinidad, abrís "Palabras clave y CV para este aviso" en el primero, marcás "Workday" porque lo usaste aunque no figure en tu CV, copiás las instrucciones, las pegás en tu IA, revisás el CV que te devuelve, lo guardás en PDF y te postulás con ese CV.

En **Configuración > Qué buscás** podés poner una **afinidad mínima** (por ejemplo 55): los avisos con menos no se postulan. Empezá sin mínimo y miralo unos días antes de usarlo. Si no cargaste el texto de tu CV, la afinidad se calcula sin la parte de palabras clave.

### Otras fuentes de avisos

Además de LinkedIn, en **Avisos para revisar** hay dos botones que suman avisos a la misma lista. Ninguno se postula: vos elegís qué hacer con cada aviso.

- **Buscar en páginas de empresas.** Lee los avisos publicados en las páginas de empleo de las empresas que cargaste en Configuración ("Páginas de empleo de empresas"), si usan **Greenhouse**, **Lever** o **Ashby**. Lo reconocés por la dirección: `boards.greenhouse.io/empresa`, `jobs.lever.co/empresa` o `jobs.ashbyhq.com/empresa`. Usa los datos públicos que esas plataformas ofrecen para armar páginas de empleo: no abre el navegador ni necesita cuenta. Aplica tus filtros (puestos, empresas a evitar, frases a evitar, afinidad mínima) y deja pasar los avisos remotos sin otro país, los de tu país, los de Latinoamérica y los de tus lugares aceptados. La corrida automática también los revisa todos los días. Estos avisos se pueden pasar al agente.
- **Buscar en Computrabajo, Bumeran y ZonaJobs.** Busca tus primeros cuatro puestos objetivo en esos sitios con la ventana de Chrome del programa, con pausas, como lo haría una persona. Lee la descripción de los primeros 12 avisos nuevos para calcular la afinidad. Si un sitio pide una verificación, frena en ese sitio. En estos portales te postulás vos con tu cuenta de cada sitio: abrí el aviso, postulate y tocá **Me postulé yo**. No se pueden pasar al agente.

El filtro **Origen** de Avisos para revisar separa LinkedIn, páginas de empresas y otros portales.

### Postular

Botón **Postular ahora**, con la cantidad máxima para esa corrida. Qué puede pasar con cada aviso:

| Resultado | Significado |
|---|---|
| ENVIADA | Enviada, registrada y anotada en el registro |
| SALTEADA | Fuera de objetivo, empresa a evitar, frase excluida o ya postulada |
| FALTAN RESPUESTAS | Faltaba una respuesta. No se envió. La pregunta quedó pendiente |
| AVISO DE LINKEDIN | LinkedIn mostró un captcha, una verificación, un aviso de restricción o el límite diario. Se detiene y pone la pausa de seguridad (sección 9) |
| NO SE ENVIÓ POR EL CV | No pudo elegir ni subir el CV que corresponde, o en la pantalla final figuraba otro. Al lado dice el motivo |

Entre una postulación y la siguiente hay pausas de 25 a 80 segundos, a propósito. Si está fuera del horario configurado o ya se llegó al tope del día, avisa y no hace nada.

### Postulación automática (opcional)

En el paso 5 del panel elegís hasta 3 horarios, los días y cuántas postulaciones como máximo por corrida, y tocás **Activar**. El programa crea una tarea en el Programador de tareas de Windows ("Job Seeker - postulacion automatica") que, en esos momentos, hace lo mismo que **Postular ahora**: revisa la sesión de LinkedIn, busca, filtra, se postula y guarda los avisos externos para el agente. No hace falta tener el panel abierto.

- Respeta tu horario, el tope diario y las pausas (sección 9). Un horario fuera de tu ventana no hace nada.
- La computadora tiene que estar prendida y con tu sesión de Windows abierta: se abre la ventana de Chrome del programa (ya no aparece una ventana negra). Si a esa hora estaba apagada o suspendida, corre apenas la prendas.
- Si hay una pausa de seguridad activa (sección 9), la corrida no hace nada y lo deja anotado.
- Si a esa hora estás usando el panel (una simulación, por ejemplo), la corrida automática se saltea; y mientras corre la automática, el panel no deja empezar otra tarea.
- Si la sesión de LinkedIn venció, no hace nada y lo deja anotado: volvé a iniciar sesión desde el panel.
- **Ver registro de las corridas** muestra lo que hizo cada vez (queda en `datos/automatico.log`). En el panel también ves la fecha y el resultado de la última.
- **Desactivar** borra la tarea de Windows.

Antes de activarla, hacé un par de postulaciones reales con **Postular ahora** y mirá que complete bien los formularios.

### Responder preguntas pendientes

Cuando un formulario pregunta algo que no tenías cargado, la pregunta aparece en el panel ("N preguntas esperan tu respuesta") y arriba de todo en Configuración. Respondés una vez y queda guardada para siempre. La próxima corrida vuelve a intentar esos avisos.

### Seguimiento

Pestaña **Seguimiento** (siempre con la barra de arriba para volver al Panel). Tiene cuatro vistas: **Resumen** (números, embudo, novedades de Gmail, lo que conviene seguir y lo que requiere tu atención), **Tablero** (una columna por etapa, con scroll propio y "Ver más"), **Lista** (tabla ordenable, también por afinidad, de a 25, 50 o 100 por página) y **Números** (ver abajo). Los filtros (búsqueda, etapa, período y origen) valen para todas. Para cambiar la etapa de una postulación, arrastrá la tarjeta a otra columna en Tablero o elegila en la fila de la Lista; durante unos segundos podés tocar **Deshacer**. Para llevarte todo a Excel: paso 7, **Exportar**, "Postulaciones (.csv)".

Tocá el nombre de una empresa (en cualquier vista) para abrir el **detalle**: movimientos de etapa, seguimiento, preparación de la entrevista, afinidad y palabras clave.

**Números.** Para ver qué te está funcionando: cuántas postulaciones enviaste, qué porcentaje tuvo respuesta (incluye rechazos), qué porcentaje avanzó a primer contacto o más, cuántos días tarda la primera respuesta (mediana), un gráfico de postulaciones por semana (últimas 12, también como tabla) y el porcentaje que avanzó según el origen y según la afinidad. Si los avisos de mayor afinidad avanzan más, conviene ponerles más energía. Con pocos datos (menos de 10) lo indica al lado. El tiempo hasta la primera respuesta sale de los cambios de etapa que hacés en el tablero o con las novedades de Gmail.

**Recordatorios de seguimiento.** Cuando una postulación lleva un tiempo sin movimiento, aparece en "Para hacer seguimiento" y con la marca **Hacer seguimiento**:

| Etapa | Te lo sugiere a los | Hasta |
|---|---|---|
| Postulada, En revisión, Contactada | 10 días sin novedades (2 veces como máximo) | 45 días |
| Primer contacto, Entrevista | 7 días (3 veces como máximo) | 30 días |
| Oferta | 4 días (2 veces como máximo) | 21 días |

En el detalle tenés un borrador corto para adaptar (completá el nombre de la persona) y tres botones: **Ya hice seguimiento** (el reloj vuelve a cero), **Recordarme en 7 días** y **No me lo recuerdes más**. El programa no envía nada: vos copiás el borrador y lo mandás por donde corresponda. Pasado el límite de la tabla, te sugiere pasarla a Rechazada o Retirada para ordenar el tablero.

**Novedades de Gmail (opcional).** El botón **Buscar novedades en Gmail** abre tu Gmail en la ventana de Chrome del programa y lee solo la lista de correos de los últimos 30 días (remitente, asunto, vista previa y fecha), sin promociones ni redes sociales. Si un correo nombra a una empresa donde tenés una postulación activa y parece un rechazo, una invitación a entrevista o un aviso de que vieron tu postulación, te propone el cambio de etapa en "Novedades de tu Gmail", con **Aplicar** o **Ignorar**. No abre, no marca como leído, no archiva y no responde ningún correo, y nada sale de tu computadora. La primera vez te pide iniciar sesión en Gmail en esa ventana.

## 9. Ritmo y límites

Valores por defecto, que cada usuario puede cambiar en **Ritmo y límites** de la página de configuración:

| Ajuste | Por defecto |
|---|---|
| Zona horaria | America/Argentina/Buenos_Aires |
| Horario | De 7 a 19. Cada día arranca entre 0 y 45 minutos después de la hora de inicio |
| Tope diario en LinkedIn | Entre 10 y 15, distinto cada día |
| Días con la mitad del tope | Sábado |
| Días sin postulaciones | Domingo |
| Máximo por empresa por día | 5 |
| Arranque gradual en LinkedIn | 2 semanas: hasta 5 por día la primera semana y hasta 10 la segunda, desde tu primera postulación automática. 0 lo desactiva |
| Avisos de Windows | Sí: una notificación de Windows cuando la corrida automática postuló, encontró avisos nuevos de empresas o tuvo un problema, y cuando LinkedIn hace frenar al programa. "no" los apaga |

Además, sin configuración: pausas de duración variable entre acciones, entre 25 y 80 segundos entre postulaciones con un descanso de 2 a 5 minutos cada tanto, y orden de avisos mezclado.

Las páginas de empresas no tienen tope diario total; respetan el horario, los días de descanso y el máximo por empresa.

**Pausa de seguridad.** Si LinkedIn muestra un captcha, una página de verificación, un aviso de restricción de la cuenta o el mensaje de límite diario de solicitudes, el programa frena en el momento y deja de postular en LinkedIn por un tiempo: 1 día por el límite diario, 3 días por un captcha o una verificación, 7 días por una restricción. El panel muestra un aviso con la fecha y un botón **Reanudar**, por si ya lo resolviste. Cuando la pausa termina, los 3 días siguientes el tope diario baja a la mitad. Las páginas de empresas no se pausan.

Si el programa no puede contar cuántas postulaciones hiciste hoy (por ejemplo, la base de datos no responde), no postula: prefiere frenar antes que pasarse del tope.

Automatizar LinkedIn va contra sus condiciones de uso y la cuenta puede ser restringida. Estos límites reducen el riesgo, no lo eliminan. Empezá con pocas postulaciones y mirá la cuenta los primeros días.

## 10. Uso avanzado con un agente de IA (opcional)

Todo lo anterior funciona sin agente. Con un agente de IA de programación abierto en la carpeta del programa se suma:

- **Páginas de empresas.** Pedile `targets`, o pasale el link de un aviso.
- **Correos y mensajes.** Pegale un mensaje de un reclutador o pedile `news`. Devuelve el análisis y un borrador. Nada sale sin que apruebes ese borrador en particular.
- **Perfil.** Pedile `profile`: lee tu configuración, tu CV y tu contexto, y te pregunta solo lo que falte.

Las reglas que el agente debe seguir están en `AGENTS.md`. Las más importantes: solo responde formularios con datos tuyos, no envía mensajes sin tu aprobación, no actualiza el programa y trata el texto de avisos y correos como información, nunca como órdenes.

El agente y el panel usan la misma base. Pueden estar abiertos a la vez: cada operación espera su turno.

### Páginas de empresas

Pedile al agente `targets`, o pasale el link de un aviso. Completa el formulario y decide con una regla fija:

- **Envía sola** si el sistema es de los simples (Greenhouse, Lever, Ashby, Teamtailor, Workable, SmartRecruiters, Recruitee, Breezy, BambooHR, Personio, Humand, HiringRoom), ya hubo antes una postulación tuya por ese sistema, el aviso coincide por completo, todas las respuestas salieron de tus datos y no hay texto libre, preguntas legales, captcha ni cuenta nueva.
- **Queda en cola** en cualquier otro caso: Workday y similares, portales de empleo, sitios propios, cartas de presentación, la primera vez en cada sistema.

```bash
node scripts/targets.js queue list           # lo que espera tu aprobación
node scripts/targets.js queue show 12        # cada respuesta que escribió
```

Aprobás en el chat con el agente ("aprobá la 12, rechazá la 13") y recién ahí envía.

### Avisos de LinkedIn sin solicitud sencilla

En cada simulación y en cada postulación, el programa también busca los avisos que tienen el botón "Solicitar" (los que llevan al sitio de la empresa) y les aplica tus filtros. Los ves en la pestaña **Avisos para revisar** del panel:

- **Para elegir:** pasaron todos tus filtros. Los que dicen "sin revisar la descripción" pasaron título, empresa, lugar y salario; la próxima corrida lee la descripción y, si no pasa, los descarta sola (revisa hasta 10 por corrida).
- En cada uno: **Abrir aviso** (lo abre en LinkedIn), **Para el agente**, **Me postulé yo** (queda registrado en Seguimiento y en tu CSV, y no vuelve a aparecer) o **Descartar**.
- **Para el agente:** al tocarlo, el agente de Claude arranca en ese momento (o apenas termine la tarea en curso) y trabaja los avisos de a uno: entra al aviso, revisa la descripción, pasa al sitio de la empresa y sigue la regla de arriba (envía solo en los casos simples; en los demás deja todo preparado "en cola"). El avance se ve en el Panel, en Actividad. Si una pregunta del formulario no tiene respuesta tuya, no la inventa: la deja en Preguntas pendientes y el aviso en cola.
- **Esperan tu aprobación:** las que el agente dejó preparadas sin enviar, con el motivo (primera vez en ese sistema, texto libre, preguntas sin responder, etc.) y lo que completó. **Aprobar y enviar** hace que el agente vuelva a abrir el formulario y la envíe; podés dejarle una nota con un cambio antes. **Rechazar** la descarta. Si falló el envío, queda con **Reintentar envío**.
- Requisito: Claude Code instalado en la computadora y con la sesión iniciada una vez (el panel avisa si no lo encuentra). El agente solo puede usar los comandos del programa; no puede tocar otros archivos ni otras páginas por su cuenta.

### Correos y mensajes

Pegale al agente un mensaje de un reclutador o pedile `news`. Te devuelve el análisis y un borrador. Nada sale sin que apruebes ese borrador en particular.

## 11. Seguridad y privacidad

Dónde vive cada cosa:

| Dato | Dónde | Sale de tu computadora |
|---|---|---|
| Perfil, respuestas, historial, contexto | Carpeta `datos` | No |
| Novedades leídas de Gmail (remitente, asunto, vista previa) | `datos/sugerencias-gmail.json` | No |
| Avisos de páginas de empresas y otros portales | `datos/avisos-externos.json` | No (el programa consulta esas páginas, sin enviar datos tuyos) |
| Registro de postulaciones automáticas | `datos` o la ruta que elijas | No |
| Contraseñas de cuentas creadas en sitios de empresas (uso con agente) | Carpeta `.secrets`, cifradas. En Windows, la clave que las abre queda protegida con tu usuario de Windows (`.secrets/clave.dpapi`): solo ese usuario, en esa computadora, puede leerla | No |
| Sesión de LinkedIn | Carpeta `.browser-profile` | No |
| Tu contraseña de LinkedIn | En ningún lado: la escribís vos en Chrome | No |

Qué sale, por diseño: tus datos van a los sitios donde postulás. Si usás un agente de IA, ese agente ve lo que lee y escribe, según las condiciones de su proveedor.

Cómo está protegido el panel: solo escucha en tu propia computadora (no es accesible desde la red), cada vez que se abre genera una clave nueva que solo conocen sus propias páginas, y los botones solo pueden ejecutar las acciones previstas, con cantidades acotadas.

Buenas prácticas:

- No compartas las carpetas `datos`, `config`, `.secrets` ni `.browser-profile`.
- Empezá siempre por una simulación.
- Automatizar LinkedIn va contra sus condiciones de uso y la cuenta puede ser restringida. Los límites reducen el riesgo, no lo eliminan.

## 12. Si lo va a usar otra persona

El programa no guarda datos personales en sus archivos. Para pasárselo a alguien, dale el archivo `JobSeeker-Windows.zip` original, o copiá tu carpeta **sin** estos elementos: `datos`, `config` (salvo `perfil.ejemplo.json`), `.secrets`, `.browser-profile` y `.env` si existiera.

La otra persona descomprime, hace doble clic en `Instalar.bat` y carga lo suyo: pega su CV, importa su planilla o arma sus propios archivos (sección 6), y ajusta su zona horaria, horario y topes (sección 9).

No hay nada específico de una profesión o un país: los puestos, las palabras clave y los idiomas los define cada uno. Las respuestas reconocen preguntas en español e inglés; en otros idiomas quedan como pendientes.

## 13. Problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| "Windows protegió su PC" al abrir `Instalar.bat` | "Más información" y "Ejecutar de todas formas" (sección 3) |
| La ventana negra se cierra al instante | Verificar que la carpeta esté descomprimida completa y no dentro del .zip |
| "Falta instalar el programa" | Ejecutar `Instalar.bat` |
| El panel dice "No autorizado" | Recargar la página (F5). La clave cambia cada vez que se abre el programa |
| El panel dice que se perdió la conexión | Se cerró la ventana negra. Abrir de nuevo el acceso directo |
| "No encontré Google Chrome" | Instalar Chrome desde https://www.google.com/chrome |
| "LinkedIn no tiene la sesión iniciada" | Botón 2 del panel, iniciar sesión en la ventana que se abre |
| "Fuera de horario" o "Tope del día alcanzado" | Ajustarlos en Configuración, Ritmo y límites |
| "Postulación en LinkedIn en pausa" | LinkedIn mostró un aviso (sección 9). Esperá la fecha que indica el panel o, si ya lo resolviste, tocá **Reanudar** |
| "No pude contar las postulaciones de hoy" | La base de datos tardó en responder. Esperá unos minutos y volvé a intentar |
| Los primeros días postula a pocos avisos | Es el arranque gradual (sección 9). Se ajusta en Ritmo y límites |
| La afinidad no muestra palabras clave | Cargá el texto de tu CV en Configuración, sección CV |
| "Buscar novedades en Gmail" pide iniciar sesión | Iniciá sesión en Gmail en la ventana de Chrome del programa y volvé a tocar el botón |
| No postula a nada | Simular y leer los motivos de descarte |
| Todas quedan en FALTAN RESPUESTAS | Responder las preguntas pendientes; cada respuesta destraba las siguientes |
| "No encuentro tu planilla en la ruta indicada" | Volver a copiar la ruta del archivo (clic derecho, "Copiar como ruta de acceso") |
| No detecta la tabla de mi planilla | Tiene que tener una fila de títulos con una columna de empresa y una de puesto, dentro de las primeras 20 filas |

## 14. Referencia de comandos

El panel cubre lo básico. Para quien prefiera la terminal (en Windows, reemplazar `node` por `runtime\node.exe` si no hay Node instalado):

```bash
# Instalación y configuración
node scripts/setup.js                         # prepara todo (lo mismo que Instalar.bat)
node scripts/dashboard.js --open [--port 7531]
node scripts/config.js show | export
node scripts/config.js import [--file f] [--dry-run]
node scripts/config.js history [--file f] [--dry-run]
node scripts/config.js context --file f.md
node scripts/config.js sync [--file planilla.xlsx]   # leer la planilla de seguimiento

# LinkedIn
node scripts/linkedin-session.js login | check | close
node scripts/gmail-novedades.js [--days 30]   # solo lectura de la lista de Gmail
node scripts/ats-avisos.js                     # avisos de páginas de empresas (Greenhouse, Lever, Ashby)
node scripts/portales.js [--max-desc 12]       # avisos de Computrabajo, Bumeran y ZonaJobs
node scripts/linkedin-easy-apply.js [--dry-run] [--max n] [--posted day|week|month]
                                    [--keywords q] [--location l] [--job-url u] [--quiet] [--force]

# Páginas de empresas, cola y preguntas (uso con agente)
node scripts/targets.js detect <url>
node scripts/targets.js gate [--company "Nombre"]
node scripts/targets.js queue list | show <id> | approve <id> | reject <id> | submitted <id>
node scripts/targets.js questions list | answer <id> "respuesta" | skip <id> | ready
node scripts/targets.js creds list

# Seguimiento y base
node scripts/pipeline.js [--funnel] [--closed] [--company n] [--card id] [--move id etapa]
node scripts/db.js --ping | --tables
node scripts/db.js "SELECT ..."               # solo lectura; --write para modificar
```

Avanzado: quien prefiera un servidor PostgreSQL propio puede indicarlo con `DATABASE_URL` en un archivo `.env` (ver `.env.example`). Sin ese archivo se usa siempre la base local.

## 15. Qué está probado y qué no

Probado en Windows, con una cuenta real de LinkedIn: la instalación con `Instalar.bat`, el panel, las simulaciones, postulaciones reales por Solicitud sencilla, la recolección de avisos externos y el agente de IA preparando postulaciones en sitios de empresas. También en Linux: la base local, el instalador, las importaciones (perfil, historial desde Excel, CSV y JSON, contexto), la lectura de una planilla real de más de 400 filas, el registro en CSV, los filtros, las respuestas estrictas y los límites de horario y tope. Hay más de 120 pruebas automáticas (`npm test`, requiere instalar las dependencias de desarrollo).

Verificado: el `node.exe` incluido en el paquete para Windows es el binario oficial de Node.js 22.23.5; su huella SHA-256 coincide con la publicada en nodejs.org.

Nuevo en las versiones 1.1 y 1.2 y probado con datos de ejemplo, todavía no con cuentas ni sitios reales: la pausa de seguridad ante avisos de LinkedIn, la lectura de novedades de Gmail, la corrida automática sin ventana negra, las notificaciones de Windows, la protección de la clave con el usuario de Windows y la búsqueda en Computrabajo, Bumeran y ZonaJobs (esos sitios cambian seguido; si un sitio no devuelve avisos, avisá). La lectura de páginas de Greenhouse, Lever y Ashby usa sus datos públicos documentados. La afinidad y las palabras clave se calculan con reglas simples sobre el texto: sirven de guía, no reemplazan tu lectura del aviso.

No probado todavía: macOS. Y LinkedIn cambia su sitio con frecuencia: si algo deja de funcionar, la simulación lo muestra antes de enviar nada.

Por eso: empezá con una simulación, después con una sola postulación, y recién entonces dejalo correr.

## 16. Gracias

Gracias por usar Job Seeker. Este programa nació de una búsqueda laboral real y de las ganas de que buscar trabajo sea un poco menos agotador. Ojalá te sirva para ordenar tu búsqueda y para llegar a la entrevista que estás esperando.

Gracias también a Germán Aliprandi, por publicar como código abierto el proyecto que sirvió de base.

Descargas y nuevas versiones: https://github.com/Andyvazquezsanchez/AV-job-seeker

Si querés contarme cómo te fue, sugerir una mejora o simplemente conectar, me encontrás en LinkedIn: [linkedin.com/in/avazquezsanchez](https://www.linkedin.com/in/avazquezsanchez)

Andy Vázquez Sánchez
