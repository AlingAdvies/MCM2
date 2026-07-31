import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWK,
  type CryptoKey,
} from 'jose';

import { AuthConfig } from './auth.config';
import {
  IdTokenVerificateur,
  TokenVerificatieFout,
} from './id-token-verificatie';

/**
 * Tests met een eigen sleutelpaar in plaats van de echte Entra-tenant.
 *
 * Dat is niet een compromis omdat de echte tenant nog niet geconfigureerd is —
 * het is strenger. Tegen de echte provider kun je alléén tokens testen die hij
 * bereid is af te geven; een verlopen token, een token met een verkeerde `aud`
 * of een handtekening van een vreemde sleutel krijg je daar niet. Precies die
 * gevallen zijn hier het belangrijkst, want dat zijn de aanvallen.
 *
 * De verificatielogica is identiek: `jose` weet niet of de sleutels van een
 * lokale set of van een JWKS-endpoint komen.
 */

const ISSUER = 'https://mcm2ciam.ciamlogin.com/test-tenant/v2.0';
const CLIENT_ID = 'client-id-van-de-backend';
const OID = '00000000-1111-2222-3333-444444444444';

const config: AuthConfig = {
  issuer: ISSUER,
  tokenEndpoint: `${ISSUER}/oauth2/token`,
  jwksUri: `${ISSUER}/discovery/keys`,
  clientId: CLIENT_ID,
  clientSecret: 'niet-gebruikt-in-deze-tests',
  redirectUri: 'https://localhost:5001/auth/callback',
  clockToleranceSeconds: 30,
};

describe('IdTokenVerificateur', () => {
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  let vreemdePrivateKey: CryptoKey;
  let verificateur: IdTokenVerificateur;

  beforeAll(async () => {
    const paar = await generateKeyPair('RS256');
    privateKey = paar.privateKey;
    publicJwk = await exportJWK(paar.publicKey);
    publicJwk.kid = 'test-sleutel';
    publicJwk.alg = 'RS256';

    // Een tweede sleutelpaar dat de verificateur niet kent: daarmee is een
    // token te maken dat er correct uitziet maar door een vreemde is
    // ondertekend.
    const vreemdPaar = await generateKeyPair('RS256');
    vreemdePrivateKey = vreemdPaar.privateKey;

    verificateur = new IdTokenVerificateur(
      config,
      createLocalJWKSet({ keys: [publicJwk] }),
    );
  });

  /** Bouwt een token dat standaard geldig is; overrides maken het ongeldig. */
  async function maakToken(
    overrides: {
      issuer?: string;
      audience?: string;
      expiratie?: string | number;
      nietVoor?: string | number;
      claims?: Record<string, unknown>;
      sleutel?: CryptoKey;
      algoritme?: string;
    } = {},
  ): Promise<string> {
    const {
      issuer = ISSUER,
      audience = CLIENT_ID,
      expiratie = '1h',
      nietVoor,
      claims = { oid: OID, email: 'kees@alingadvies.nl', name: 'Kees' },
      sleutel = privateKey,
      algoritme = 'RS256',
    } = overrides;

    let token = new SignJWT(claims)
      .setProtectedHeader({ alg: algoritme, kid: 'test-sleutel' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiratie);

    if (nietVoor !== undefined) {
      token = token.setNotBefore(nietVoor);
    }

    return token.sign(sleutel);
  }

  describe('accepteert een geldig token', () => {
    it('leest de identiteit uit de claims', async () => {
      const identiteit = await verificateur.verifieer(await maakToken());

      expect(identiteit.externalSubject).toBe(OID);
      expect(identiteit.email).toBe('kees@alingadvies.nl');
      expect(identiteit.naam).toBe('Kees');
    });

    it('gebruikt oid als sleutel, niet sub', async () => {
      // In Entra is `sub` per applicatie verschillend (pairwise). Wie daarop
      // koppelt, krijgt bij een tweede app-registratie een andere waarde voor
      // dezelfde persoon — en dus een tweede gebruiker.
      const token = await maakToken({
        claims: { oid: OID, sub: 'een-heel-andere-waarde' },
      });

      const identiteit = await verificateur.verifieer(token);

      expect(identiteit.externalSubject).toBe(OID);
      expect(identiteit.externalSubject).not.toBe('een-heel-andere-waarde');
    });

    it('laat ontbrekende optionele claims weg zonder te falen', async () => {
      const identiteit = await verificateur.verifieer(
        await maakToken({ claims: { oid: OID } }),
      );

      expect(identiteit.externalSubject).toBe(OID);
      expect(identiteit.email).toBeUndefined();
      expect(identiteit.naam).toBeUndefined();
    });

    it('accepteert een token binnen de klokspeling', async () => {
      // 10 seconden verlopen, speling is 30: nog geldig. Dit bewijst dat de
      // speling werkt en niet per ongeluk 0 is.
      const token = await maakToken({
        expiratie: Math.floor(Date.now() / 1000) - 10,
      });

      await expect(verificateur.verifieer(token)).resolves.toBeDefined();
    });
  });

  describe('weigert wat niet te vertrouwen is', () => {
    it('weigert een handtekening van een onbekende sleutel', async () => {
      // De kern van de hele module: zonder deze controle kan iedereen een
      // token maken met welke claims dan ook.
      const token = await maakToken({ sleutel: vreemdePrivateKey });

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        TokenVerificatieFout,
      );
    });

    it('weigert een verlopen token buiten de speling', async () => {
      const token = await maakToken({
        expiratie: Math.floor(Date.now() / 1000) - 600,
      });

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        TokenVerificatieFout,
      );
    });

    it('weigert een token dat nog niet geldig is', async () => {
      const token = await maakToken({
        nietVoor: Math.floor(Date.now() / 1000) + 600,
      });

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        TokenVerificatieFout,
      );
    });

    it('weigert een andere issuer', async () => {
      // Een geldig token van een ándere identity provider mag hier niet
      // werken, ook al is de handtekening op zichzelf correct.
      const token = await maakToken({
        issuer: 'https://kwaadaardig.example.com/v2.0',
      });

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        TokenVerificatieFout,
      );
    });

    it('weigert een token bedoeld voor een andere applicatie', async () => {
      // Token-doorgifte: een token dat een gebruiker aan een ándere app gaf,
      // hier opnieuw aanbieden. De aud-controle houdt dat tegen.
      const token = await maakToken({ audience: 'een-andere-app' });

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        TokenVerificatieFout,
      );
    });

    it('weigert een token zonder oid-claim', async () => {
      const token = await maakToken({
        claims: { email: 'kees@alingadvies.nl', sub: 'wel-een-sub' },
      });

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        /geen bruikbare oid-claim/,
      );
    });

    it('weigert een lege oid-claim', async () => {
      const token = await maakToken({ claims: { oid: '   ' } });

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        /geen bruikbare oid-claim/,
      );
    });

    it('weigert een oid die geen tekst is', async () => {
      const token = await maakToken({ claims: { oid: 12345 } });

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        /geen bruikbare oid-claim/,
      );
    });

    it('weigert onzin die geen token is', async () => {
      await expect(verificateur.verifieer('dit-is-geen-jwt')).rejects.toThrow(
        TokenVerificatieFout,
      );
    });

    it('weigert een leeg token', async () => {
      await expect(verificateur.verifieer('')).rejects.toThrow(
        TokenVerificatieFout,
      );
    });

    it('lekt geen claimwaarden in de foutmelding', async () => {
      // Foutmeldingen belanden in logs. Een melding die de inhoud van een
      // afgewezen token doorgeeft, zet daarmee gegevens van een gebruiker in
      // een logbestand — juist bij een mislukte poging.
      const token = await maakToken({
        issuer: 'https://kwaadaardig.example.com/v2.0',
        claims: { oid: OID, email: 'geheim@voorbeeld.nl' },
      });

      try {
        await verificateur.verifieer(token);
        throw new Error('had moeten falen');
      } catch (err) {
        expect((err as Error).message).not.toContain('geheim@voorbeeld.nl');
        expect(err).toBeInstanceOf(TokenVerificatieFout);
      }
    });
  });

  // TEGENPROEF, 2026-07-30 — en de uitkomst is eerlijker dan comfortabel.
  //
  // Met `algorithms: TOEGESTANE_ALGORITMEN` uit de verificatie verwijderd
  // bleven BEIDE tests hieronder groen. De bescherming komt dus van `jose`
  // zelf, niet van onze configuratieregel:
  //
  //   - `alg: none` weigert jose categorisch, ongeacht de optie.
  //   - Een HS256-token faalt omdat de sleutelbron het type bepaalt: de JWKS
  //     wijst een RSA-sleutel aan, en daar valt geen HMAC mee te verifiëren.
  //     De tokenheader mag beweren wat hij wil.
  //
  // Deze twee tests bewijzen daarmee dat de aanvallen niet werken — niet dat
  // onze regel ze tegenhoudt. Dat is nuttig om te weten: de regel blijft staan
  // als tweede slot (jose kan van gedrag veranderen, en expliciet is beter dan
  // impliciet), maar wie hem ooit weghaalt moet niet denken dat een groene
  // suite bewijst dat het veilig was.
  describe('algoritme-verwarring', () => {
    it('weigert een HS256-token ondertekend met de publieke sleutel', async () => {
      // De publieke sleutel als HMAC-geheim: precies de aanval. Die sleutel
      // staat in de JWKS en is dus voor iedereen op te halen.
      const geheim = new TextEncoder().encode(String(publicJwk.n));

      const token = await new SignJWT({ oid: OID })
        .setProtectedHeader({ alg: 'HS256', kid: 'test-sleutel' })
        .setIssuedAt()
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setExpirationTime('1h')
        .sign(geheim);

      await expect(verificateur.verifieer(token)).rejects.toThrow(
        TokenVerificatieFout,
      );
    });

    it('weigert een token dat met alg: none is gemaakt', async () => {
      // De klassieke omzeiling: een token zonder handtekening, met alleen
      // `alg: none` in de header. Werkt alleen als de verificatie het
      // algoritme uit het token overneemt in plaats van het voor te schrijven.
      const kop = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const inhoud = Buffer.from(
        JSON.stringify({
          oid: OID,
          iss: ISSUER,
          aud: CLIENT_ID,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');

      await expect(verificateur.verifieer(`${kop}.${inhoud}.`)).rejects.toThrow(
        TokenVerificatieFout,
      );
    });
  });
});
