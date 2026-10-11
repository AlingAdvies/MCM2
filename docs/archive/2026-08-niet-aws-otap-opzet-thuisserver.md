# Niet-AWS OTAP-opzet — thuisserver

## Doel

Deze eerste inrichting gebruikt geen AWS. Development draait op de laptop; acceptatie en productie draaien als twee gescheiden Docker Compose-stacks op een thuisserver achter Tailscale. Voor data, authenticatie en documentopslag gebruikt iedere omgeving een eigen managed Supabase-project. De opzet is een tussenstap: praktisch zelf te beheren en later migratievriendelijk, maar acceptatie en productie zijn nog niet fysiek onafhankelijk.[cite:17][cite:19]

## Hardwareverdeling

| Omgeving | Hardware | Draait hierop | Doel |
|---|---|---|---|
| Development | Laptop | VS Code, Claude Code, Git, Docker; lokale frontend/API en eventueel lokale testdata | Bouwen en technisch testen |
| Acceptatie | Thuisserver | `mcm-acc` Docker Compose-stack, Caddy-route voor acceptatie | Release functioneel testen |
| Productie | Dezelfde thuisserver | `mcm-prod` Docker Compose-stack, Caddy-routes voor klanten | Live applicatie |
| Acceptatie-data | Managed Supabase-project | Test-Postgres, test-Auth, test-Storage | Geen live data |
| Productie-data | Apart managed Supabase-project | Live Postgres, live Auth, live Storage | Klant- en bewijsdata |

Supabase kan self-hosted met Docker, maar dat betekent beheer van meerdere componenten. In deze fase is een apart managed Supabase-project per omgeving eenvoudiger dan ook Supabase zelf thuis beheren.[cite:38][cite:40][cite:50]

## Compleet netwerkplaatje

```text
                                 INTERNET
                                     |
                         Publiek DNS + HTTPS
                                     |
              +----------------------+--------------------+
              |                                           |
   app.jouwdomein.nl / api.jouwdomein.nl       acc.jouwdomein.nl / api.acc.jouwdomein.nl
       klanten en eindgebruikers                  alleen via Tailscale toestaan
                                     |
                                   :443
                                     v
+------------------------------------------------------------------+
| THUISNETWERK                                                     |
|                                                                  |
| Router/firewall: forward alleen TCP 443 (en zo nodig 80)         |
|                     naar thuisserver. Geen SSH/Docker-poorten.  |
|                                                                  |
|  +------------------------------------------------------------+  |
|  | THUISSERVER: Tailscale node + Docker host                  |  |
|  |                                                            |  |
|  |  Caddy reverse proxy: enige web-ingang, TLS, host routing  |  |
|  |       |                                |                   |  |
|  |       v                                v                   |  |
|  |  Docker project mcm-prod          Docker project mcm-acc   |  |
|  |  - prod-web                       - acc-web                |  |
|  |  - prod-api                       - acc-api                |  |
|  |  - prod-worker                    - acc-worker             |  |
|  |  - mcm-prod_default               - mcm-acc_default        |  |
|  |  - /opt/mcm/productie             - /opt/mcm/acceptatie    |  |
|  +-------|--------------------------------|-------------------+  |
+----------|--------------------------------|----------------------+
           | HTTPS/API                      | HTTPS/API
           v                                v
+--------------------------+       +--------------------------+
| SUPABASE PRODUCTIE       |       | SUPABASE ACCEPTATIE      |
| live database/auth/files |       | test database/auth/files |
+--------------------------+       +--------------------------+

+------------------------------------------------------------------+
| PRIVÉ BEHEERNETWERK: TAILSCALE                                  |
| Laptop (VS Code, Claude Code, Git, Docker) --encrypted--> server|
| Toegestaan: beheer-SSH, monitoring, acceptatie.                 |
| Niet toegestaan: publieke SSH of directe Docker-daemon-toegang. |
+------------------------------------------------------------------+
```

Caddy kan als reverse proxy HTTPS afhandelen en verkeer op hostnaam naar de juiste interne Docker-service sturen. Applicatiecontainers hoeven daardoor niet zelf rechtstreeks publiek bereikbaar te zijn.[cite:97][cite:99][cite:104]

## Domeinen

| Doel | Adres | Toegang |
|---|---|---|
| Lokale frontend | `http://localhost:3000` | Alleen laptop |
| Lokale API | `http://localhost:3001` | Alleen laptop |
| Acceptatie frontend | `https://acc.jouwdomein.nl` | Alleen Tailscale/testers |
| Acceptatie API | `https://api.acc.jouwdomein.nl` | Alleen via acceptatie-app |
| Productie frontend | `https://app.jouwdomein.nl` | Publiek |
| Productie API | `https://api.jouwdomein.nl` | Via productie-app |
| Serverbeheer | `ssh beheerder@<tailscale-servernaam>` | Alleen Tailscale |

Tailscale MagicDNS geeft apparaten binnen het tailnet een leesbare naam; gebruik die voor serverbeheer in plaats van IP-adressen.[cite:78][cite:81]

## Serverstructuur

```text
/opt/mcm/
├── acceptatie/
│   ├── compose.yml
│   ├── .env
│   └── deploy.sh
└── productie/
    ├── compose.yml
    ├── .env
    └── deploy.sh
```

Start altijd met expliciete projectnamen:

```bash
# Acceptatie
docker compose --project-name mcm-acc --env-file /opt/mcm/acceptatie/.env -f /opt/mcm/acceptatie/compose.yml up -d

# Productie
docker compose --project-name mcm-prod --env-file /opt/mcm/productie/.env -f /opt/mcm/productie/compose.yml up -d
```

Docker Compose ondersteunt gescheiden projectnamen en configuratiebestanden; hierdoor worden services, netwerken en volumes per omgeving afzonderlijk aangemaakt.[cite:80][cite:87][cite:88]

## Docker-netwerken

```text
proxy
├── Caddy
├── prod-web / prod-api
└── acc-web / acc-api

mcm-prod_default: prod-web, prod-api, prod-worker
mcm-acc_default:  acc-web, acc-api, acc-worker
```

De standaardnetwerken en volumes van acceptatie en productie mogen nooit gedeeld worden. Alleen web- en API-services die Caddy moet bereiken, hangen aanvullend aan het gedeelde `proxy`-netwerk.[cite:103][cite:104]

## Supabase en secrets

| Regel | Acceptatie | Productie |
|---|---|---|
| Supabase | Eigen project | Ander eigen project |
| Keys | Alleen in `/opt/mcm/acceptatie/.env` | Alleen in `/opt/mcm/productie/.env` |
| Gebruikers/documenten | Testdata | Live data |
| Service-role key | Niet op laptop | Niet op laptop en niet in acceptatie |

Gebruik nooit dezelfde Supabase-project-URL, anon key, service-role key, storagebucket of gebruikersset voor beide omgevingen. Productiedata wordt niet naar acceptatie gekopieerd zonder anonimisering.[cite:19]

## Tailscale-toegang

Maak ten minste deze logische rollen:

- `group:beheerder`: SSH, monitoring en volledige beheerroute naar de thuisserver.
- `group:testers`: alleen HTTPS-toegang tot acceptatie.
- `tag:homeserver`: label op de thuisserver.

Tailscale ACL’s/Grants kunnen toegang per groep, bestemming en poort vastleggen. Laat Tailscale dus niet standaard onbeperkte toegang geven aan alle apparaten in de tailnet.[cite:92][cite:93][cite:94][cite:100]

## Firewall en poorten

| Poort | Internet | Tailscale | Gebruik |
|---|---:|---:|---|
| TCP 443 | Ja | Ja | Caddy/HTTPS |
| TCP 80 | Alleen indien nodig | Nee | Redirect of certificaatvalidatie |
| TCP 22 | Nee | Alleen beheerder | SSH |
| 3000/3001/etc. | Nee | Nee | Alleen intern Docker-verkeer |
| Docker 2375/2376 | Nee | Nee | Nooit openzetten |
| Databasepoorten | Nee | Nee | Supabase uitsluitend via TLS/API |

## Releaseproces

1. Ontwikkelen en technisch testen op de laptop.
2. Deployen naar `mcm-acc`.
3. Controleren op `acc.jouwdomein.nl`.
4. Pas na expliciete acceptatie deployen naar `mcm-prod`.
5. Controleren op `app.jouwdomein.nl`.

Gebruik aparte deployscripts, branches of release-tags voor acceptatie en productie. Hiermee wordt de scheiding niet alleen technisch, maar ook procedureel bewaakt.[cite:19][cite:36]

## Minimale beheersmaatregelen

- Geef acceptatie en productie aparte Linux-gebruikers indien praktisch uitvoerbaar.
- Gebruik aparte Compose-projecten, `.env`-bestanden, Docker-volumes, netwerken en Supabase-projecten.
- Stel acceptatie niet publiek open; beperk die route via Tailscale of aanvullende authenticatie.
- Stel geen SSH-, Docker- of containerpoorten publiek open.
- Maak dagelijks versleutelde back-ups van database en documentbestanden buiten de thuisserver.
- Test periodiek een volledig herstel van database én documenten.
- Monitor diskruimte, containerstatus, certificaatvernieuwing en back-upresultaten.

## Risico en vervolg

De opzet scheidt acceptatie en productie logisch, maar niet fysiek: dezelfde thuisserver, stroom, router, internetverbinding en opslag blijven één gedeeld risico. Voor de huidige fase is dat een bruikbare tussenoplossing; voor een bedrijfskritische SaaS met blijvende documentretentie moet productie later naar externe managed infrastructuur worden verplaatst.[cite:17][cite:19]

Wanneer dat moment komt, kan vooral de `mcm-prod` stack worden verplaatst. De namen, containers, secretscheiding, reverse-proxylogica en aparte Supabase-projecten blijven als ontwerpprincipe bruikbaar.
