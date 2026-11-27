# Rifacimento del gameplay della campagna

Bozza del 25 novembre 2026, da approvare prima di scrivere codice.
Base: le richieste di Nico in queste sessioni («scopiazzerei completamente Call of War», più i «100 accorgimenti già detti»).
Prendiamo le **meccaniche** di Call of War, non la sua grafica, i suoi nomi o la sua interfaccia: l'aspetto resta quello di Archeon.

## Cosa non va oggi (dalle parole di Nico)

- Le province si **comprano col tocco**, anche quelle nemiche: non ha senso.
- La **terra libera** richiede ancora tempo per essere presa.
- **Economia** confusa: fabbriche che rendono poco, produzione sparsa, un minuto per fare una truppa, cibo che manca e blocca.
- **Reparti** che appena piazzati corrono e conquistano a caso; difficili da gestire.
- Il **sasso-carta-forbice** tra reparti non si sente: non si compensa un esercito con l'altro.
- **IA** che arriva da tutte le parti; reparti nemici che compaiono senza vederli nascere.
- **Nebbia di guerra** non percepibile; **nuvole** che sono un'immagine appoggiata sopra, non integrate.
- **Interfaccia** che appare sopra, a destra, a sinistra: va ripensata da zero; comandi scomodi, cose che si intrecciano, a volte lag.
- **Icone dei reparti** da rifare: un'icona sola, fatta meglio.
- **Bot**: devono essere tanti e deboli all'inizio, con pochi imperi forti che li assorbono (alla OpenFront), così la mappa è viva all'inizio e poi restano pochi nemici forti.
- **Logistica, terreno, mondo** da migliorare; il calcolo di truppe e rifornimenti rispetto a quello che puoi costruire deve essere chiaro.
- **Lore** della campagna quasi assente: entri e non sai per cosa combatti.

## Il nuovo ciclo di gioco

### 1. Province e conquista
- Una provincia si prende **solo con un esercito** che ci entra. Niente più tocco che compra.
- Terra libera: l'esercito entra e la prende in pochi secondi (una provincia ogni pochi secondi di marcia).
- Provincia di qualcuno: l'esercito deve battere i difensori; le **città** si assediano (difesa più alta, un po' di tempo).
- Ogni provincia ha: terreno, risorsa principale, produzione, uomini disponibili, edifici, morale/controllo.

### 2. Eserciti
- Gli eserciti si **producono nelle tue città** (o dove c'è una caserma): costano risorse e uomini e richiedono un tempo di produzione, con coda visibile.
- Si muovono **solo dove li mandi**, lungo un percorso mostrato sulla mappa. Arrivati si fermano. Niente avanzata automatica.
- Si **uniscono** in un esercito misto e si **dividono**; un esercito mostra un'icona sola (il tipo principale) e il numero dei reparti.
- **Sasso-carta-forbice vero**: fanteria batte ricognitori, ricognitori battono artiglieria, artiglieria batte fanteria; corazzati forti contro fanteria ma deboli contro genio e artiglieria, ecc. Un esercito misto compensa i punti deboli.
- Rifornimento: un esercito lontano dalle tue linee perde forza.

### 3. Combattimento
- Due eserciti nella stessa provincia combattono finché uno non cede; si vede chi sta vincendo.
- Bonus e malus: terreno (montagne difendono), fortificazioni, rifornimento, tipo contro tipo.
- Gli eserciti nemici **escono dalle loro città** in modo visibile (niente spawn a caso).

### 4. Economia e costruzioni
- Risorse chiare: **cibo, metallo, benzina e uomini** (gli uomini servono a produrre eserciti).
- Ogni provincia rende la sua risorsa al minuto; le città rendono di più.
- Costruzioni per provincia, una per tipo: fabbrica (più produzione), caserma (produce eserciti), fortificazioni, deposito di rifornimenti, ecc.
- Un **pannello economia** fisso dice: entrate al minuto, consumo degli eserciti, cosa puoi permetterti ora.
- Il cibo mantiene gli eserciti; se manca si vede subito dove e perché.

### 5. Mondo, fazioni e IA
- **Tanti bot piccoli** all'inizio + **pochi imperi forti**; gli imperi assorbono i bot, così all'inizio la mappa è piena e poi restano pochi rivali forti.
- IA che attacca da fronti leggibili, con preavviso (offensive), non da tutte le parti insieme.
- **Nebbia di guerra visibile**: velo scuro dove non vedi, vedi dove hai province, eserciti, radar.
- **Mappa della logistica** (rifornimento) e **mappa del terreno** migliorate, leggibili.
- Nuvole: integrate nella mappa (ombre sotto, mai sopra le scritte) o tolte.

### 6. Interfaccia fissa
- **In alto**: risorse con entrate al minuto, tempo, velocità/pausa.
- **In basso al centro**: un solo pannello contestuale (provincia, esercito o città selezionata) sempre nello stesso posto.
- **A sinistra**: elenco dei tuoi eserciti e coda di produzione.
- **A destra**: obiettivi e messaggi radio.
- Niente finestre che compaiono in punti diversi. Comandi da tastiera chiari (selezione, ordini, pausa).

### 7. Lore della campagna
- **Briefing** prima di ogni fronte: chi sei, per cosa combatti, cosa succede se perdi.
- **Radio** durante la partita: messaggi brevi che raccontano e annunciano gli obiettivi.
- **Obiettivi del fronte** legati alla storia, con un finale.
- **Rapporto finale narrato** con un pezzo di lore sbloccato.

### 8. Ritmo
- Da decidere: campagna da 20–30 minuti con velocità ×1/×2/×4 e pausa, oppure partite lunghe come l'originale.

## Come si costruisce

A pezzi, ognuno giocabile, in una **modalità nuova accanto a quella attuale** finché non è migliore (poi la sostituisce):

1. Eserciti: produzione nelle città, movimento solo su ordine, conquista solo con eserciti, icone nuove.
2. Combattimento e sasso-carta-forbice; eserciti misti.
3. Economia e pannello economia; costruzioni.
4. Interfaccia fissa e comandi.
5. Bot alla OpenFront, IA a fronti, nebbia visibile, nuvole integrate.
6. Logistica, terreno e mondo.
7. Lore: briefing, radio, obiettivi del fronte, rapporto.

Ogni pezzo: simulazione per tarare i numeri, prova nel browser, poi lo giochi tu.

## Da decidere con Nico
- Ritmo (sopra, punto 8).
- La campagna attuale resta disponibile finché la nuova non è pronta, o si sostituisce subito?
- Gli eserciti si producono solo nelle città o in ogni provincia con una caserma?
