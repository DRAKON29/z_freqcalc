"""
Longley-Rice Irregular Terrain Model (ITM) v1.2.2 — point-to-point.
ВЕНДОРЕННЫЙ ПОРТ для роадмапа 2.1 (модель 'itm' в /api/calculate).

Источник: конверсия FORTRAN → Python (ITM v1.2.2, Aug 71/Mar 77/Aug 84) от
Mike Markowski, AB3AP — https://github.com/ab3ap/itm (см. также https://ab3ap.github.io/itm/).
Оригинальный код NTIA/ITS (Institute for Telecommunication Sciences, Boulder CO) —
работа правительства США, public domain (см. https://github.com/NTIA/itm-longley-rice).
Адаптация под сервис z_freqcalc: файл используется как есть, без правок логики.

Конвенции использования (см. itm_model.py):
  • ITM возвращает ИЗБЫТОЧНОЕ затухание A (Eq 5.1/5.2 TN101) поверх FSPL по длине профиля;
  • aVar(zzT, 0, zzS) — квантили времени: zzT = Φ⁻¹(p/100) для «потери превышаются p % времени»
    (эмпирически проверено: zT>0 → затухание меньше медианы, кривая убывает с ростом p, как в ITU).
"""
#!/usr/bin/env python

'''
Longley-Rice Irregular Terrain Model (1968)
v1.2.2 (Aug 71/Mar 77/Aug 84)

Converted to python by
Mike Markowski, mike.ab3ap@gmail.com
Mar 2023

One of my goals converting ITM to python is to have the equations more
closely match the papers.  In addition, I undid many precalculations
that are unnecessary on modern computers.  The original fortran code,
due to constraints of 1970s era computers, focused on efficiency and
is subsequently hard to understand.  Many values were precalculated to
reduce runtime.  For example, many equations are converted from

  log10(x) == ln(x)/ln(10) == 0.4343 ln(x)

Runtime speedup is unlikely yet reduces readability and reduces results
to 4 significant figures.  There are other similar efforts to optimize
code rather than let the compiler or interpreter do so.  Great effort
goes into compiler/interpreter code optimization, and it is unnecessary
and even unwise to try to "game" the compiler.

I reference equations throughout the code when possible.  This helps
the student of Longley-Rice more easily see transition from theory to
implementation.  Additionally, I tried to remove 'for' loops where possible
and replace with vector math, both simplifying code and allowing vector
calculations to be passed to different cores by numpy.

Throughout the code, equations are referenced in the following using the
abbreviations shown.  If an equation source reference is not given, it is
from GH12:

1) TN101: "Transmission Loss Predictions for Tropospheric Communication
Circuits," 1965, Rice, Longley, Norton, and Barsis.

2) LR68: "Prediction of Tropospheric Radio Transmission Loss Over Irregular
Terrain A Computer Method-1968," Longley & Rice

3) GH12: "The ITS Irregular Terrain Model, version 1.2.2 The Algorithm,"
Hufford.  2012 year taken from date of TeX file.

4) HLK82: "A Guide to the Use of the ITS Irregular Terrain Model
in the Area Prediction Mode," 1982, Hufford, Longley, Kissck.

Some subroutines start with comment blocks copied verbatim from one of the
references listed above.

Original Fortran common blocks prop, propa and propv are retained as global
python dictionaries.  Fields maintain the original and sometimes confusing
fortran names.  The following list comes from the v1.2.2 manual distributed
with the Fortran version:

Primary parameters.  'prop' dictionary keys:

  Inputs:
    dh    (float):    terrain irregularity parameter.
    dist  (float):    distance between two terminals.
    dl    (float[2]): horizon distances.
    ens   (float):    surface refractivity of the atmosphere, N-units.
    f_MHz (float):    transmit carrier frequency.
    gme   (float):    earth's effective curvature, 1/a, 1/earth's radius.
    he    (float[2]): antenna effective heights.  From GH12: The "effective
          height" of an antenna is its height above an "effective reflecting
          plane" or above the "intermediate foreground" between the antenna
          and its horizon. A difficulty with the model is that there is no
          explicit definition of this quantity, and the accuracy of the model
          sometimes depends on the skill of the user in estimating values for
          these effective heights.

    hg    (float[2]): antenna structural heights above ground.
    mdp   (int):   controlling mode
                     -1: point-to-point mode
                      1: area mode, beginning
                      0: area mode, continuing
    the   (float[2]): horizon elevation angles.
    wn    (float):   wave number of radio frequency, k in many equations.
    zgnd  (complex):  surface transfer impedance of the ground, unitless.

  Outputs:
    aref  (float): reference attenuation.
    err   (int): error indicator [kwx in fortran code.]
                1- no error.
                2- warning: some parameters are nearly out of range.
                   results should be used with caution.
                4- note: default parameters have been substituted for
                   impossible ones.
                8- warning: a combination of parameters is out of range.
                   results are probably invalid.
                other- warning: some parameters are out of range.
                   results are probably invalid.

Secondary parameters.  'propa' dictionary keys.

  inputs:
    dlsa (float):    line-of-sight distance
    dx   (float):    scatter cross-over distance
    ael  (float):    line-of-sight coefficient
    ak1  (float):    line-of-sight coefficient
    ak2  (float):    line-of-sight coefficient
    aed  (float):    diffraction coefficient
    emd  (float):    diffraction coefficient
    aes  (float):    scatter coefficient
    ems  (float):    scatter coefficient
    dls  (float[2]): smooth earth horizon distances
    dla  (float):    total horizon distance
    tha  (float):    total bending angle

Variability parameters.  'propv' dictionary keys.

    klim (int): climate code, values decreased by 1 from Fortran:
      0   Equatorial
      1   Continental subtropical
      2   Maritime subtropical
      3   Desert
      4   Continental temperate
      5   Maritime temperate, overland
      6   Maritime temperate, oversea

    lvar (int): control switch,
      Use of lvar has been updated so that the programmer using itm.py has no
      need to be aware it exists.  itm.py will update lvar as needed to
      eliminate repeated calculations.

      Level to which coefficients in AVAR must be redefined.  Each
      time the parameter indicated below is changed, lvar must be
      set to at least:
         level   parameter
           0       quantiles
           1       DIST
           2       HE, etc.
           4       WN
           8       MDVAR
          16       KLIM

      The subroutine AVAR will compute the necessary coefficients
      and reset LVAR to 0.  It will recalculate all values of a given level
      number and lower.  E.g., level 16 recalculates everything.

    mdvar(int): desired mode of variability
         1   Single message mode.  Time, location, and situation
             variability are combined together to give a con-
             fidence level
         2   Individual/Accidental mode.  Reliability is given by time
             availability for the individuial receiver of a broadcast station.
             Confidence is a combination of location and situation variability.
         4   Mobile mode.  Reliability is a combination of time
             and location variability.  Confidence is given by the
             situation variability.
         8   Broadcast mode.  Reliability is given by the twofold
             statement of -at least- qT of the time in qL of the
             locations.  Confidence is given by the situation
             variability.
      In addition, to these values may be ORed either or both of
      the following
        16   For the point-to-point mode.  Location variability is
             eliminated.
        32   For interference problems.  Direct situation
             variability is eliminated.  Note that there may still
             be a small residual situation variability.

    sgc(double): standard deviation of confidence, which may be used
      to compute a confidence level.
'''

import numpy as np

version = '1.2.2'
cVacuum_mps = 299792458    # m/s, speed of light, Wikipedia.
c_mps = cVacuum_mps/1.0003 # m/s, c in air, using refractive index of air.
f0 = c_mps/(2*np.pi*1e6)   # m, wave number normalization for f in MHz. ~47.7.
rEarth_m = 6371e3          # m, average radius of earth, Wikipedia.

# The following sets of names (error, climate, levels of calculation, and
# modes of variability) allow the user to use them with getters/setters
# without need to worry about implementation details.

# Error names.
eNone      = 0x0000 # No error.
eQuantiles = 0x0001 # Warning: Quantiles < isf(1e-3) == 3.1.
eClimate   = 0x0002 # Warning: Climate was not set.  Set to cont temp.
eDist1k    = 0x0004 # Warning: Distance over 1000 km, nearly out of range.
eDistBad   = 0x0008 # Error: Distance not in interval [1km, 2000km] or is less
                    #        than 5x00(ant effective hgts difference).
eModeVar   = 0x0010 # Warning: mode of variability was unset.  Use Single Msg.
eFreqWarn  = 0x0020 # Warning: freq < 40 MHz or freq > 10 GHz.
eAntWarn   = 0x0040 # Warning: antenna structure height not between 1m and 1km.
eAntErr    = 0x0080 # Error: antenna struct hgt < 0.5m or > 3km.
eHorizErr  = 0x0100 # Error: earth horizons error.
eNsErr     = 0x0200 # Error: Ns not in [250, 400] N-units.
eECurveErr = 0x0400 # Error: earth curvature not in [75e-9, 250e-9].
eImpedErr  = 0x0800 # Error: earth curvature not in [75e-9, 250e-9].
eFreqErr   = 0x1000 # Error: freq not in [20, 2000] MHz.

# Climate names.
cEquatorial   = 0
cContSubtrop  = 1
cMariSubtrop  = 2
cDesert       = 3
cContTemp     = 4
cMariTempLand = 5
cMariTempSea  = 6

# Level of aVar() recalculation names.
lQuant = 1
lDist  = 2
lAnt   = 4
lFreq  = 8
lMode  = 16
lClim  = 32

# Modes of variability names.  Exactly one of following 4 is chosen.
mClear  = 0   # Clear mdvar setting.
mSingle = 1   # Single message mode.
mRandom = 2   # Individual/Accidental mode.
mMobile = 4   # Mobile mode.
mBcast  = 8   # Broadcast mode.
# Either or both of following can be used in addition to above modes.
mPfl    = 16  # Point-to-point mode.
mIfere  = 32  # Interference problems.

# Dictionaries (former Fortran COMMON blocks).
prop = {}
propa = {}
propv = {}
avMem = {} # Replaces the SAVE block in the Fortran aVar() function.

def attenDiff(s):
    # Original name: adiff
    '''Find the diffraction attenuation at distance d.  It uses a convex
    combination of smooth earth diffraction and double knife-edge
    diffraction.  A call with d==0 sets up initial constants.

    NOTE: There is a fairly significant difference in the calculation
    of the weight, w, in this subroutine as compared with Hufford's
    original.  Why there is so much difference is worth studying.
    The most extreme example so far, this routine calculates 0.21 and
    Hufford's 0.25.  This routine is more precise due to fewer rounded
    off intermediate optimizations made in the original code.

    Inputs:
      s (float): distance in m to calculate diffraction attenuation.
      prop (dictionary): see program comments for details.
      propv (dictionary): see program comments for details.

    Outputs:
      (float): diffraction attenuation in dB.
    '''

    global prop, propa

    # Extract variables to make code below readable.
    deltaH   = prop['dh']    # Terrain irregularity parameter
    dLj      = prop['dl']    # Eq 3.3. Horizon distances. 1x2 vec.
    f_MHz    = prop['f_MHz'] # Transmit carrier frequency.
    gammaE   = prop['gme']   # Earth's effective curvature.
    he       = prop['he']    # Antenna effective hgts, 1x2 vector.
    hg       = prop['hg']    # Antenna structure hgts, 1x2 vector.
    modeProp = prop['mdp']   # -1 point-to-point, 0 & 1 area prediction mode.
    wn       = prop['wn']    # Wave number.
    Zg       = prop['zgnd']  # Surface transfer impedance of earth.

    dL       = propa['dla']  # Eq 3.7, dL = dLj[0] + dLj[1].
    dLs      = propa['dlsa'] # Eq 3.6, sum of smooth earth distances.
    thetaE   = propa['tha']  # Sum of rough earth elevation angles.

    # Calculate clutter attenuation, Afo.
    deltaHs = interdecileRange_m(deltaH, dLs) # Eq 3.9, s := dLs.
    sigmaH = roughness_m(deltaHs)
    Afo = min(15, 5*np.log10(1+f_MHz*hg[0]*hg[1]*sigmaH*1e-5)) # LR68 Eq 3.38c.

    gamma = 2*he / dLj**2      # Eq 4.15, 1x2 vector.
    alpha = (wn/gamma)**(1/3)  # Eq 4.16, 1x2 vector.
#   K = 1/(alpha*Zg)           # Eq 4.17, with 6.2, 1x2 vector.
    K = 1/(alpha*abs(Zg))      # Eq 4.17, with 6.2, 1x2 vector.
    A = 151.03                 # Given below Eq 4.20.
#   B = 1.607 - abs(K)         # Eq 6.2 approximation for B(K).
    B = 1.607 - K              # Eq 6.2 approximation for B(K).
    xj = A*B * alpha*gamma*dLj # Eq 4.18, 1x2 vector.
    xht = xj[0] + xj[1]        # Eq 4.19 x1 + x2, height gain.
    C1 = 20                    # C1(K) = 20 dB, described below Eq 4.25.
    aht = Fse(xj[0], K[0]) + Fse(xj[1], K[1]) + C1 # Eq 4.20, F() & C() terms.

    # Calculate Ak, double knife attenuation.
    theta = thetaE + s*gammaE        # Eq 4.12
    vj = theta/2 * np.sqrt(wn/np.pi * dLj*(s - dL)/(s - dL + dLj)) # Eq 4.13
    Ak = knife(vj[0]) + knife(vj[1]) # Eq 4.14, knife-edge diffractions.

    # Calculate Ar, rounded earth attenuation.
    gamma0 = theta/(s - dL)          # Eq 4.15, j=0
    alpha0 = (wn/gamma0)**(1/3)      # Eq 4.16, j=0
    K0 = 1/(alpha0 * Zg)             # Eq 4.17, j=0
    A = 151.03                       # Given below Eq 4.20.
    B = 1.607 - abs(K0)              # Eq 6.2 approx for B(K).
    x0 = A*B*alpha0*theta + xht      # Eq 4.19, j=0
    G = 0.05751*x0 - 10*np.log10(x0) # Eq 6.3 approximation.
    Ar = G - aht                     # Eq 4.20, rounded earth diffraction.

    # Calculate Adiff, diffraction attenuation.
    # Eq 4.9, numerator of 2nd term of Q.  Denominator changes with distance.
    # Eq 4.9 Q defn leaves out braces, corrected in NTIA TR 15-517, App A.4.
    deltaHs = interdecileRange_m(deltaH, s) # Eq 3.9
    C = 10 if modeProp == -1 else 0      # Eq 4.9
    # Q large when deltaH large, 0 when deltaH is 0.
    Q = np.sqrt((he[0]*he[1] + C)/(hg[0]*hg[1] + C))
    Q += (dL + thetaE/gammaE)/s          # Eq 4.9
    Q *= min(1000, deltaHs*wn/(2*np.pi)) # Eq 4.9
    w = 1/(1 + 0.1*np.sqrt(Q))           # Eq 4.9, 0 rough, 1 smooth earth.
    Adiff = (1 - w)*Ak + w*Ar + Afo      # Eq 4.11
    return Adiff

def attenLos(s, Aed, md):
    '''Find the line-of-sight attenuation at the distance d.  A convex
    combination of plane earth fields and diffracted fields is used.

    Inputs:
      s (float): distance in LOS attenuation calculation.
      Aed (float): extended diffraction attenuation.
      md (float): slope m, diffraction attenuation/distance.
    Outputs:
      (float): line-of-sight attenuation in dB.
    '''

    global prop, propa

    # Extract variables to make code below readable.
    deltaH = prop['dh']    # Terrain irregularity parameter
    f_MHz  = prop['f_MHz'] # Transmit carrier frequency.
    he     = prop['he']    # Antenna effective hgts, 1x2 vector.
    wn     = prop['wn']    # Wave number.
    Zg     = prop['zgnd']  # Surface transfer impedance of earth.
    dLs    = propa['dlsa'] # Eq 3.6, sum of smooth earth distances.

    deltaHs = interdecileRange_m(deltaH, s)    # Eq 3.9
    sigmaHs = roughness_m(deltaHs)
    sinPsi = (he[0] + he[1])/np.sqrt(s*s + (he[0] + he[1])**2) # Eq 4.46
    # XXX min(10, ...) in fortran code but not GH12.
    Rep = ((sinPsi - Zg)/(sinPsi + Zg)
        * np.exp(-min(10, wn*sigmaHs*sinPsi))) # Eq 4.47
    if abs(Rep) >= max(1/2, np.sqrt(sinPsi)):
        Re = Rep                               # Eq 4.48
    else:
        Re = Rep/abs(Rep) * np.sqrt(sinPsi)    # Eq 4.48
    deltap = 2*wn*he[0]*he[1]/s                # Eq 4.49
    if deltap <= np.pi/2:
        delta = deltap                         # Eq 4.50
    else:
        delta = np.pi - (np.pi/2)**2 / deltap  # Eq 4.50
    Ad = Aed + md*s # Eq 4.45, extended diffraction range attenuation.
    At = -20*np.log10(np.abs(1 + Re*np.exp(1j*delta))) # Eq 4.51, 2-ray atten.

    # Note that f_MHz = wn*f0.
    D2 = 10e3                                  # m, given in Eq 4.43.
    # w goes to 0 as earth becomes rough (deltaH large).
    w = 1/(1 + f_MHz*deltaH/max(D2, dLs))      # Eq 4.43, weighting factor.
    Alos = (1 - w)*Ad + w*At                   # Eq 4.44, weighted combination.
    return Alos

def attenScatter(d, h0s=-15):
    # Original name: ascat
    '''Find the tropospheric forward scatter attenuation at the distance d.
    Use an approximation to the method of NBS TN101 with checks for
    inadmissable situations.  This is expected to be called twice in
    succession, first with the larger distance d==d6, second with d==d5
    for proper operation.

    Inputs:
      d (float): distance in m at which to calculate scatter attenuation.
      h0s (float): frequency gain, default -15 dB.
    Outputs:
      scat_dB (float): tropo scatter attenuation in dB.
      h0s (float): frequency gain in dB.  Returned for use with subsequent
        call at shorter distance, d.
    '''

    global prop, propa

    dLj    = prop['dl']    # Horizon distances.
    f_MHz  = prop['f_MHz'] # Transmit carrier frequency.
    Ns     = prop['ens']   # Surface refractivity, N-units.
    he     = prop['he']    # Antenna effective heights.
    gammaE = prop['gme']   # Earth's effective curvature.
    theta  = prop['the']   # Rough earth horizon elevation angles.
    wn     = prop['wn']    # Wave number, k in many equations.
    thetaE = propa['tha']  # Sum of rough earth elevation angles.

    if dLj[0] > dLj[1]:          # Station 1 has larger horizon range.
        dlDiff = dLj[0] - dLj[1] # Part of Eq 4.64
        rRatio = he[1]/he[0]     # Part of q defn below 6.14
    else:                        # Staion 2 has larger horizon range.
        dlDiff = dLj[1] - dLj[0] # Part of Eq 4.64
        rRatio = he[0]/he[1]     # Part of q defn below 6.14

    if h0s > 15:
        h0_dB = h0s
    else:
        # See TN101v1 Chap9, TN101v2 Annex III.5 for full understanding.
        thetaP = theta[0] + theta[1] + d*gammaE # Eq 4.61
        rVec = 2*wn*thetaP * he  # Eq 4.62 and Eq 9.4a in TN101v1, 1x2 vector.
        if all(rVec < 0.2):      # See text underneath 4.62.
            return np.inf,np.inf # Function is undefined (infinite).
        # Calculate assymetry factor, ss.  Crossover pt assumed to be midpoint.
        ss = (d - dlDiff)/(d + dlDiff) # Eq 4.65 after some algebra.

        q = rRatio / ss   # Eq 6.14, text underneath.
        q = max(0.1, q)   # Eq 6.14, text underneath.
        q = min(10, q)    # Eq 6.14, text underneath.
        ss = max(0.1, ss) # Eq 6.14, text underneath.
        ss = min(10, ss)  # Eq 6.14, text underneath.

        # Calculate scatter efficiency, etaS.
        z0_m = d*thetaP*ss/(1 + ss)**2        # Eq 4.66, crossover height.
        Z0 = 1756                             # m, Eq 4.67
        Z1 = 8000                             # m, Eq 4.67
        etaS = z0_m/Z0 * (1 + (0.031 - 2.32e-3*Ns + 5.67e-6*Ns**2)
            * np.exp(-min(1.7, z0_m/Z1)**6))  # Eq 4.67 and Eq 9.3a TN101v1.

        # Calculate frequency gain function h0.
        h00_dB = H00(rVec, max(etaS, 1))
        deltaH0 = 6*(0.6 - np.log10(etaS))*np.log10(ss)*np.log10(q) # Eq 6.11
        # XXX min() from Fortran code, but not in alg_itm.pdf.
        h0_dB = h00_dB + min(h00_dB, deltaH0) # Eq 6.10
        if h0_dB > 15 and h0s > 0:
            h0_dB = h0s

    h0s = h0_dB
    th = thetaE + gammaE*d                # Eq 4.60
    # Eq 4.63 and 4.68
    scat_dB = 10*np.log10(f_MHz*th**4) + Fts(th*d, Ns) + h0_dB # Eq 4.63
    return scat_dB, h0s

def aVar(zzT, zzL, zzS):
    '''Variability, quantiles of attenuation.

    LrProp will stand alone to compute aref. To complete the story,
    however, one must find the quantiles of the attenuation and this is
    what aVar() will do.  It, too, is a standalone subroutine, except that
    it requires the output from lrProp, as well as values in a "variability
    parameters" common block, propv.  Of these, sgc is output and may be
    used to answer the inverse problem: with what confidence will a
    threshold signal level be exceeded.

    When in the area prediction mode, one needs a threefold quantile
    of attenuation which corresponds to the fraction qT of time, the
    fraction qL of locations, and the fraction qS of "situations." In
    the point-to-point mode, one needs only qT and qS . For efficiency,
    aVar is written as a function of the "standard normal deviates"
    zT, zL, and zS corresponding to the requested fractions. Thus,
    for example, qT=Q(zT) where Q(z) is the "complementary standard
    normal distribution." For the point-to-point mode one sets zL=0
    which corresponds to the median qL=0.50.

    The subprogram is written trying to reduce duplicate calculations. This
    is done through the switch lvar.

    1) On first entering, set lvar=lClim.   Then all parameters will be
       initialized, and lvar will be changed to lQuant.

    2) If the program is to be used to find several quantiles with different
       values of zT, zL, or zS, then lvar should be lQuant, as it is.

    3) If the distance is changed, set lvar=lDist and parameters that depend
       on the distance will be recomputed.

    4) If antenna heights are changed, set lvar=lAnt;

    5) if the frequency, lvar=lFreq;

    6) if the mode of variability mdvar, set lvar=lMode;

    7) and finally if the climate is changed, set lvar=lClim. The higher the
       value of lvar, the more parameters will be recomputed.

    Original Fortran common block variables are stored in the
    propv dictionary.

    See GH12 Section 6 for a discussion of the input parameters below and how
    they are variously combined.

    Inputs:
      zzT (float): Quantile of attenuation for fraction of times.
      zzL (float): Quantile of attenuation for fraction of locations.
      zzS (float): Quantile of attenuation for fraction of situations.
    Output:
      A (float), sigmaS (float): adjusted Aref, std dev of confidence.
    '''

    global avMem, prop, propv

    '''This curve fit method is undocumented in ITM.  It looks vaguely
    like a yield-density or Michaelis-Mentin equation, but
    with squared X's and multiple terms.  Maybe even related
    to Split Lorentzian??  Holling formula seems most similar:
    https://esajournals.onlinelibrary.wiley.com/doi/10.1002/ecs2.3051
    c[0] is asymptote.
    '''

    # This curve fit method is undocumented in ITM.
    curv = lambda c,x,de: (c[0] + c[1]/(1 + ((de-x[1])/x[2])**2)) \
            * (de/x[0])**2 / (1 + (de/x[0])**2)

    # Climatic constants for equatorial, continental subtropical, maritime
    # subtropical, desert, continental temperate, maritime over land, maritime
    # over sea.

    # The following sets of arrays provide curve fit coeffients to mimic
    # climatic data presented in TNv101, section 10.

    # V(0.5,d_e), long-term median transmission loss for climate region.
    # Data in TN101 Figure 10.13 and also ITM Algorithm 5.5.
    cv = [[ -9.67,   -0.62,     1.26,  -9.21,   -0.62,   -0.39,     3.15],
          [ 12.7,     9.19,    15.5,    9.05,    9.19,    2.86,   857.9]]
    yv = [[144.9e3, 228.9e3, 262.6e3,  84.1e3, 228.9e3, 141.7e3, 2222.e3],
          [190.3e3, 205.2e3, 185.2e3, 101.1e3, 205.2e3, 315.9e3, 164.8e3],
          [133.8e3, 143.6e3,  99.8e3,  98.6e3, 143.6e3, 167.4e3, 116.3e3]]

    # Sigma_t- curve coefficients.  GH12 Eq 5.7.
    csm = [[  2.13,    2.66,    6.11,    1.98,    2.68,    6.86,    8.51],
           [159.5,     7.67,    6.65,   13.11,    7.16,   10.38,  169.8]]
    ysm = [[762.2e3, 100.4e3, 138.2e3, 139.1e3,  93.7e3, 187.8e3, 609.8e3],
           [123.6e3, 172.5e3, 242.2e3, 132.7e3, 186.8e3, 169.6e3, 119.9e3],
           [ 94.5e3, 136.4e3, 178.6e3, 193.5e3, 133.5e3, 108.9e3, 106.6e3]]

    # Sigma_t+ coefficients.  GH12 Eq 5.7.
    csp = [[  2.11,    6.87,   10.08,    3.68,   4.75,    8.58,    8.43],
           [102.3,    15.53,    9.60,  159.3,    8.12,   13.97,    8.19]]
    ysp = [[636.9e3, 138.7e3, 165.3e3, 464.4e3, 93.2e3, 216.0e3, 136.2e3],
           [134.8e3, 143.7e3, 225.7e3, 93.1e3, 135.9e3, 152.0e3, 188.5e3],
           [ 95.6e3,  98.6e3, 129.7e3, 94.2e3, 113.4e3, 122.7e3, 122.9e3]]

    # Ducting constants in GH12 Table 5.1.
    CD = [1.224, 0.801, 1.380,  1.000, 1.224, 1.518, 1.518] # CD column.
    zD = [1.282, 2.161, 1.282, 20.,    1.282, 1.282, 1.282] # zD column.

    # Frequency C coefficients for sigma- and sigma+.
    cfm = [[1.0,  1.0, 1.0, 1.0,  0.92, 1.0, 1.0],
           [0.0,  0.0, 0.0, 0.0,  0.25, 0.0, 0.0],
           [0.0,  0.0, 0.0, 0.0,  1.77, 0.0, 0.0]]
    cfp = [[1.0, 0.93, 1.0, 0.93, 0.93, 1.0, 1.0],
           [0.0, 0.31, 0.0, 0.19, 0.31, 0.0, 0.0],
           [0.0, 2.00, 0.0, 1.79, 2.00, 0.0, 0.0]]

    wn = prop['wn']    # Wave number.
    if lvarGet(lClim): # Climate calculations.
        clim = propv['klim']
        checkClimate() # Use default if klim arrives unset.
        # Extract column for specified climate.
        avMem['cv'] = np.array(cv)[:,clim]
        avMem['yv'] = np.array(yv)[:,clim]
        avMem['csm'] = np.array(csm)[:,clim]
        avMem['ysm'] = np.array(ysm)[:,clim]
        avMem['csp'] = np.array(csp)[:,clim]
        avMem['ysp'] = np.array(ysp)[:,clim]
        avMem['cfm'] = np.array(cfm)[:,clim]
        avMem['cfp'] = np.array(cfp)[:,clim]
        avMem['CD'] = CD[clim]
        avMem['zD'] = zD[clim]

    if lvarGet(lMode): # Mode of variability calculations.
        modeIfere = mdvarGet(mIfere) # Interference, no situation variability.
        modePfl = mdvarGet(mPfl)    # Pt to pt, no location variability.
        avMem['modeIfere'] = modeIfere
        avMem['modePfl'] = modePfl
        checkModeVar()

    if lvarGet(lFreq): # Frequency calculations.
        # Calculate scale factor for Eqs 5.7.
        cfm = avMem['cfm']
        cfp = avMem['cfp']
        avMem['gm'] = cfm[0] + cfm[1]/((cfm[2]*np.log(0.133*wn))**2 + 1)
        avMem['gp'] = cfp[0] + cfp[1]/((cfp[2]*np.log(0.133*wn))**2 + 1)

    if lvarGet(lAnt): # Antenna height calculations.
        # Eq 5.3
        he = prop['he'] # Antenna effective heights.
        a1 = 9000e3     # m, below Eq 5.3
        D1 = 1266e3     # m, below Eq 5.3
        dex = np.sqrt(2*a1*he[0]) + np.sqrt(2*a1*he[1]) + a1*(wn*D1)**(-1/3)
        avMem['dex'] = dex

    if lvarGet(lDist): # Distance calculations.
        dex = avMem['dex']
        dist= prop['dist']       # Distance in m between stations.
        D0 = 130e3               # m, below Eq 5.4
        if dist < dex:
            de = D0*dist/dex     # Eq 5.4, effective distance.
        else:
            de = D0 + dist - dex # Eq 5.4, effective distance.
        avMem['de'] = de

        CD = avMem['CD']
        cfm = avMem['cfm']
        cfp = avMem['cfp']
        csm = avMem['csm']
        csp = avMem['csp']
        cv = avMem['cv']
        de = avMem['de']
        gm = avMem['gm']
        gp = avMem['gp']
        modeIfere = avMem['modeIfere']
        modePfl = avMem['modePfl']
        ysm = avMem['ysm']
        ysp = avMem['ysp']
        yv = avMem['yv']
        zD = avMem['zD']

        Vmed = curv(cv, yv, de)         # Eq 5.5
        sigmaTm = gm*curv(csm, ysm, de) # Eq 5.7
        sigmaTp = gp*curv(csp, ysp, de) # Eq 5.7
        sigmaTD = sigmaTp*CD            # Eq 5.8

        #   L o c a t i o n   V a r i a b i l i t y
        if modePfl: # Point to point, no location variability.
            sigmaL = 0.0
        else:
            deltaH = prop['dh'] # Terrain irregularity parameter.
            deltaHs = interdecileRange_m(deltaH, dist) # Eq 3.9
            sigmaL = 10*wn*deltaHs/(wn*deltaHs + 13)   # Below Eq 5.9

        #   S i t u a t i o n   V a r i a b i l i t y
        if modeIfere: # Interference mode, no situational variability.
            sigmaS = 0.0
        else:
            D = 100e3 # m
            sigmaS = 5 + 3*np.exp(-de/D) # Eq 5.10

        avarRecalc(lQuant) # Reset flags to recalculate only quantiles.
        avMem['Vmed'] = Vmed
        avMem['sigmaL'] = sigmaL
        avMem['sigmaS'] = sigmaS
        avMem['sigmaTm'] = sigmaTm
        avMem['sigmaTp'] = sigmaTp
        avMem['sigmaTD'] = sigmaTD

    Vmed = avMem['Vmed']
    zT, zL, zS = avarCorrectDeviates(zzT, zzL, zzS)
    Yr, YS, sigmaS = avarResolveStddevs(zT, zL, zS)
    Aref = prop['aref']          # Reference attenuation in dB.
    Ap   = Aref - Vmed - Yr - YS # Eq 5.1, Yr = YL + YT
    if Ap >= 0:                  # Eq 5.2
        A = Ap
    else:
        A = Ap * (29 - Ap)/(29 - 10*Ap) # Eq 5.2
    return A, sigmaS # Adjustment to Aref, std dev of confidence.

def avarCorrectDeviates(zzT, zzL, zzS):
    '''aVar() uses three standard normal deviates (random variables with
    expected value 0 and mean 1), but not all are needed for the four modes
    of transmission modeled by ITM.  When not all are needed, 1 or 2 are
    combined with another, but order is important.  First, situation is
    chosen, then location, then time.

    Inputs:
      zzT, zzL, zzS (floats): deviates of quantiles of time, location and
        situation.  I.e., inverses of complementary normal distributions.
        Depending on mode of variability/transmission, some will be combined
        to generate the output.
    Outputs:
      zT, zL, zS (floats): deviates of quantiles of time, location and
        situation.
    '''

    #   C o r r e c t   N o r m a l   D e v i a t e s
    if mdvarGet(mSingle): # Single message mode.
        # Combine time, location and situation.
        zT = zzS # Unused.
        zL = zzS # Unused.
        zS = zzS
    elif mdvarGet(mRandom): # Individual (aka Accidental or Random) mode.
        # Combine location and situation.
        zT = zzT
        zL = zzS # Unused.
        zS = zzS
    elif mdvarGet(mMobile): # Mobile mode.
        # Combine time and location.
        zT = zzT
        zL = zzT # Unused.
        zS = zzS
    elif mdvarGet(mBcast): # Broadcast mode.
        zT = zzT # Standard normal deviate for fraction of times, qT.
        zL = zzL # Standard normal deviate for fraction of locations, qL.
        zS = zzS # Standard normal deviate for situation/confidence, qS.
    if abs(zT) > 3.1 or abs(zL) > 3.1 or abs(zS) > 3.1:# or q == 0.1%.
        errorSet(eQuantiles) # Nearly out of range, results uncertain.
    return zT, zL, zS

def avarRecalc(level=lClim):
    '''For a given level of aVar() recalculation, set the bit for that level
    and all lower levels.  Levels from low to high are:
      lQuant: recalculate quantiles of observations.
      lDist:  recalc values related to distance from antenna.
      lAnt:   values related to antenna heights.
      lFreq:  values related to frequency.
      lMode:  values related mode of transmission.
      lClim:  values related to climate.
    An important exception is that choosing lQuant will clear all other
    levels.  This is because aVar() will always recalculate quantiles
    regardless of flag settings, so this a convenient way to clear existing
    settings.

    Input:
      level (int): one of values in list above.
    Output:
      none
    '''
    global propv
    if level == lQuant:
        propv['lvar'] = lQuant # Clear lvar settings.
    else:
        propv['lvar'] |= 2*level - 1

def avarResolveStddevs(zT, zL, zS):
    '''See section 6.2 in HLK82f or a complete discussion on the deviations
    of Eq 4 and their standard deviations.

    Inputs:
      zT, zL, zS (floats): deviates of quantiles of time, location and
        situation.  I.e., inverses of complementary normal distributions.
    Outputs:
      Yr, YS (floats): deviations of time & location combined as well as
        deviation of situation.
      sigmaS (float): standard deviation of situation deviate, or confidence.
        It can be used to compute a confidence level.
    '''

    global avMem

    # Quantile calculations.
    sigmaL = avMem['sigmaL']
    sigmaS = avMem['sigmaS']
    sigmaTm = avMem['sigmaTm']
    sigmaTp = avMem['sigmaTp']
    sigmaTD = avMem['sigmaTD']
    zD = avMem['zD'] # Low probability ducting constant, Table 5.1 in GH12.

    # Time variability, GH12 Eq 5.6.  YT is piecewise linear in zT.
    if zT < 0:
        sigmaT = sigmaTm
        YT = sigmaTm*zT # Eq 5.6, first case.
    elif zT <= zD:
        sigmaT = sigmaTp
        YT = sigmaTp*zT # Eq 5.6, second case.
    else:
        YT = sigmaTp*zD + sigmaTD*(zT - zD) # Eq 5.6, third case.
        sigmaT = YT/zT

    # Eq 5.9, location variability, YL.  
    YL = sigmaL*zL # Eq 5.9

    # Eq 5.11, Situation variability, vS.  
    rT = 7.8
    rL = 24
    vS = sigmaS**2 + YT**2/(rT + zS**2) + YL**2/(rL + zS**2) # Most of Eq 5.11.
    # Resolve deviations Yr, YS dB.
    if mdvarGet(mSingle):    # Single message mode.
        Yr = 0.0
        sigmaS = np.sqrt(sigmaT**2 + sigmaL**2 + vS)
    elif mdvarGet(mRandom):  # Individual/Accidental mode.
        Yr = YT
        sigmaS = np.sqrt(sigmaL**2 + vS)
    elif mdvarGet(mMobile):  # Mobile mode.
        Yr = zT * np.sqrt(sigmaT**2 + sigmaL**2)
        sigmaS = np.sqrt(vS) # Confidence threshold that signal level exceeds.
    else:                    # Broadcast mode.
        Yr = YT + YL
        sigmaS = np.sqrt(vS)
    YS = sigmaS*zS             # Eq 5.11
    return Yr, YS, sigmaS

def calcDeltaH(dist, pfl, x1, x2):
    # Original name dlthx
    '''Using the terrain profile pfl we find deltaH, the
    interdecile range of elevations between the two points x1 and x2.
    The interdecile range is the difference between the first and the
    ninth deciles, 10% and 90%, a measure of statistical dispersion
    of values in the data set.

    See LR1968 Sec 2.2 or TN101v2 Sec I.3.2: The Terrain Roughness
    Factor Delta h, "Different types of terrain are distinguished
    according to the value of a terrain roughness factor Delta h.
    This is the interdecile range of terrain heights in meters above
    and below a straight line fitted to the average slope of the terrain.

    Hufford's original dlthx() function was optimized for regular distance
    values.  To support arbitrary ranges, his subroutine was replaced
    with this one.  He also resampled the original terrain profile.
    This subroutine uses the full profile which has minor effects on
    the reference attenuation, typically 0.1 dB or less, and should be
    the more accuarate value.

    Inputs:
      dist (float[]): meters, distances to terrain points.
      pfl (float[]): terrain profile, elevations above sea level.
      x1 (float): real world distance to start deltaH calculation.
      x2 (float): real world distance to stop deltaH calculation.
    Output:
      float: terrain roughness factor.
    '''

    # For fitted line get: slope, intercept, start/stop indices of fit.
    m, b, i0, i1 = leastSqr(dist, pfl, x1, x2, yVals=False)

    # Subtract line from profile and order deltas.
    line = m*dist + b
    deltaHgt = pfl[i0:i1+1] - line[i0:i1+1] # Height deltas.
    ds = sorted(deltaHgt)      # Sort height deltas.

    # Find 1st and 9th decile distances, remembering that the
    # dist array is sorted ascending but can be irregularly spaced.
    n = 1 + i1 - i0   # Number of profile points.
    dec1 = int(0.1*n) # Distance to 1st decile location.
    dec9 = int(np.ceil(0.9*n))   # Distance to 9th decile location.
    dec9 = min(dec9, n-1)
    # Get array indices of 1st and 9th deciles.

    dh = ds[dec9] - ds[dec1]   # Interdecile, 9th-1st deciles.
    dh /= interdecileRange_m(1, x2-x1)
    return dh

def checkClimate():
    '''Verify that the climate index, propv['klim'], is legal.  If not, set
    it to Continental Tremperate and raise the warning flag that defaults
    were used.

    Climate indices:
    cEquatorial   = 0
    cContSubtrop  = 1
    cMariSubtrop  = 2
    cDesert       = 3
    cContTemp     = 4
    cMariTempLand = 5
    cMariTempSea  = 6
    '''

    global propv

    if not (0 <= propv['klim'] <= 6): # Error, climate not set.
        errorSet(eClimate) # Indicate that a value default was substituted.
        propv['klim'] = cContTemp # Continental Temperate.

def checkDist():
    '''A function that simply verifies that the distance, prop['dist'],
    between two stations is valid for ITM analysis.  The distance is
    extracted from the dictionary of primary values with key 'dist'.
    '''

    global prop

    dist = prop['dist']
    he = prop['he']

    if dist <= 0:
        return
    if dist > 1000e3:
        errorSet(eDist1k)  # Nearly out of range.
    dmin = abs(he[0] - he[1])/200e-3
    if dist < dmin:      # Error, distance much too small.
        errorSet(eDistBad) # Out of range, results likely invalid.
    if not (1e3 <= dist <= 2000e3): # Error, distance too small or large.
        errorSet(eDistBad) # Out of range, results likely invalid.

def checkModeVar():
    '''Verify that the mode of variability, i.e., mode of transmission, is
    set.  If not, set it to Single Message Mode, and raise warning that a
    default value was substituted.
    '''

    global propv

    if (propv['mdvar'] & 0xf == 0): # Error, mode unset.
        propv['mdvar'] = mSingle    # Single message mode.
        errorSet(eModeVar)          # Indicate that a default was set.

def checkRange():
    '''Check that various variables are in the proper range for ITM to
    calculate valid results.  Ranges checked for prop keys: dl, gme, hg, ens,
    the, wn and zgnd.  The single propa key dls is also checked.
    '''

    global prop, propa

    # Inputs, primary parameters.
    dLj      = prop['dl']   # Horizon distances.
    gammaE   = prop['gme']  # Earth's effective curvature.
    hg       = prop['hg']   # Antenna structural heights.
    Ns       = prop['ens']  # Surface refractivity, N-units.
    the      = prop['the']  # Rough earth horizon elevation angles.
    wn       = prop['wn']   # Wave number, k in many equations.
    Zg       = prop['zgnd'] # Surface refractivity, N-units.
    # Inputs, secondary parameters.
    dLsj     = propa['dls'] # Smooth earth horizon distances.
    # Outputs, primary parameters.

    # Check parameter ranges 7 in itm.pdf.
    if not (0.838 <= wn <= 210):        # Check wave number.
        errorSet(eFreqWarn)             # Nearly out of range.
    for j in range(2):
        if not (1 <= hg[j] <= 1000):    # Check antenna structure height.
            errorSet(eAntWarn)          # Nearly out of range.
        if not (0.5 <= hg[j] <= 3000):  # Check antenna structure height.
            errorSet(eAntErr)           # Out of range, results invalid.
        if (abs(the[j]) > 200e-3
            or not (0.1*dLj[j] <= dLsj[j] <= 3*dLj[j])):
            errorSet(eHorizErr)         # Out of range, results invalid.
    if not (250 <= Ns <= 400):          # Surface refractivity.
        errorSet(eNsErr)                # Out of range, results likely invalid.
    if not (75e-9 <= gammaE <= 250e-9): # Earth curvature.
        errorSet(eECurveErr)            # Out of range, results likely invalid.
    if Zg.real <= abs(Zg.imag):         # Surface transfer impedance.
        errorSet(eImpedErr)             # Out of range, results likely invalid.
    if not (0.419 <= wn <= 420):        # Wave number check.
        errorSet(eFreqErr)              # Out of range, results likely invalid.

def dictionaries():
    '''Set the three dictionaries corresponding to the original Fortran
    COMMON blocks to reasonable defaults.

    Input:
      None
    Outputs:
      None, but prop, propa, propv (dictionaries) are set to defaults.
    '''

    global prop, propa, propv

    # Primary parameters.  Defaults are for continental temperate.
    prop['aref'] = 0                 # Reference attenuation in dB.
    prop['dh'] = 90                  # Terrain roughness factor.
    prop['dist'] = 0                 # Distance in m beteen stations.
    prop['dl'] = np.array([0., 0.])  # Terrain horizons for stations 1 and 2.
    prop['ens'] = 301                # Surface refractivity, N-units.
    prop['gme'] = 0                  # Earth's effective curvature.
    prop['he'] = np.array([0., 0.])  # Effective antenna heights.
    prop['hg'] = np.array([3., 3.])  # Antenna structure heights.
    prop['mdp'] = 0 # Propagation mode. -1 point to point, 1 area.
    prop['the'] = np.array([0., 0.]) # Rough earth horizon elevation angles.
    prop['wn'] = 0                   # Wave number.
    prop['zgnd'] = 0+0j              # Earth transfer impedance.

    # Secondary parameters.  Calculated in lrProp().
    propa['dla'] = 0  # Sum of two rough earth horizon distances.
    propa['dlsa'] = 0 # Sum of two smooth earth horizon distances.
    propa['dls'] = np.array([0., 0.]) # Smooth earth horizon distances.
    propa['dx'] = 0   # Scatter cross-over distance.
    propa['tha'] = 0  # Sum of rough earth elevation angles.

    # Variability parameters.  Mostly for aVar().
    propv['err'] = 0   # Create key, value is meaningless.
    errorSet(eNone)    # No error initially.
    propv['klim'] = cContTemp  # Continental temperate.
    propv['lvar'] = 0  # Create key, val is meaningless.
    propv['mdvar'] = 0 # Create key, val is meaningless.
    avarRecalc()       # Set lvar to highest level of aVar() recalculation.
    mdvarSet(mBcast)   # Set mdvar to broadcast mode.

def errors():
    '''Based on bits set in the error variable prop['err'], return two lists
    of strings. One is a list of warnings, the other a list of errors.

    Outputs:
      e, w (string[]): lists of error and warning messages corresponding to
        bits set in propv['err'].
    '''

    global propv

    e = [] # Errors.
    w = [] # Warnings.
    err = propv['err']
    if err == eNone:
        return e, w

    #   W a r n i n g s
    if err & eQuantiles:
        w.append('Quantile < 0.1%.')
    if err & eClimate:
        w.append('Climate unset.  Using Continental Temperate.')
    if err & eDist1k:
        w.append('Distance>1000 km, approaching 2000 km limit.')
    if err & eModeVar:
        w.append('Mode of variability unset.  Using Single Message mode.')
    if err & eFreqWarn:
        w.append('Frequency outside 40 to 1000 MHz, '
            'approaching 20 to 2000 MHz limit.')
    if err & eAntWarn:
        w.append('Antenna structure height outside 1 to 1000 m.')

    #   E r r o r s
    if err & eDistBad:
        e.append('Distance outside 1 to 2000 km or is '\
            '<5*(ant hgts difference).')
    if err & eAntErr:
        e.append('Antenna structural height outside 0.5 to 3000 m.')
    if err & eHorizErr:
        e.append('Earth horizons error.')
    if err & eNsErr:
        e.append('Refractivity Ns not 250 to 400 N-units.')
    if err & eECurveErr:
        e.append('Earth curvature not 75e-9  to  250e-9.')
    if err & eImpedErr:
        e.append('Earth impedance, real(Z) < imag(Z).')
    if err & eFreqErr:
        e.append('Frequency outside 20 to 2000 MHz.')

    return e, w

def errorGet(err=None):
    '''Return True/False if passed error is currently set/unset.

    Input:
      err (int): one of
        eNone   No error.
        eEdge   Some parameters are nearly out of range.
        eSubst  Unset values have been set to defaults.
        eRange  A combination of parameters is out of range.
        eRange2 Some parameters are out of range.
    Output:
      (boolean): status of error setting or propv['err'] if err==None.
    '''

    global propv
    if err is None:
        return propv['err']
    else:
        return (propv['err'] & err) != 0

def errorSet(level):
    '''Raise error flag to one of:
        eNone   No error.
        eEdge   Some parameters are nearly out of range.
        eSubst  Unset values have been set to defaults.
        eRange  A combination of parameters is out of range.
        eRange2 Some parameters are out of range.
    '''

    global propv
    if level == eNone:
        propv['err'] = eNone # Clear all error flags.
    else:
        propv['err'] |= level

def freespace_dB(f_Hz, r_m):
    '''Calculate freespace path loss in dB.
    fspl = 20 log10(4 pi r/lambda) = 20 log10(4 pi r f/c)

    This is nearly twice as fast as the commonly seen
      fspl = 32.45 + 20*log10(f_MHz) + 20*log10(r_km)
    due to two calls to log10().  It also uses fewer approximations.
    E.g., 20*log10(4*pi/0.2997925) = 32.44778

    Inputs:
      f_Hz (float): frequency in Hz.
      r_m (float): distance in meters to calculate path loss.
    Output:
      (float): freespace path loss in dB.
    '''

    return 20*np.log10(4*np.pi*r_m*f_Hz/cVacuum_mps)

def Fse(x, K):
    # Original name: fht
    '''Function F() for smooth earth diffraction defined by Vogler,
    mentioned under GH12 Eq 4.20.  Height gain over a smooth spherical earth
    to be used in the "three radii" method.  The approximation is
    that given in GH12 Eq 6.4.
    '''

    G = lambda x: 0.05751*x - 10*np.log10(x)
    F1 = lambda x: -117 if x == 0 else 40*np.log10(x) - 117

    if x <= 200: # Eq 6.4, case 0 < x <= 200.
        cond = K < 1e-5 or -x*np.log10(K)**3 > 450 # Eq 6.6, case condition.
        # F2 = lambda x,K: F1(x) if cond else 2.5e-5*x**2/K + 20*np.log10(K)-15
        # res = F2(x, K)
        res = F1(x) if cond else 2.5e-5*x**2/K + 20*np.log10(K) - 15 # Eq 6.6
    elif x < 2000: # Eq 6.4, x < 2000.
        res = G(x) + 0.0134 * x * np.exp(-x/200) * (F1(x) - G(x))
    else: # Eq 6.4, x >= 2000.
        res = G(x)
    return res

def Fts(D, Ns):
    # Original name: ahd
    '''For troposhperic scatter, calculate F(D, Ns) GH12 Eq 6.8.

    Input:
      D (float): distance in meters.
      Ns (float): surface refractivity, N-units.
    Output:
      (float): F(D, Ns).
    '''

    # Eq 6.9 cases to decide coefficients, c[].
    if D <= 10e3:   # 0 < D <= 10km
        c = np.array([133.4, 332e-6, -10])
    elif D <= 70e3: # 10km < D <= 70km
        c = np.array([104.6, 212e-6, -2.5])
    else:           # otherwise
        c = np.array([71.8, 157e-6, 5])
    F0 = c[0] + c[1]*D + c[2]*np.log10(D)    # Eq 6.9, F0(D)
    D0 = 40e3                                # m, Eq 6.8
    return F0 - 0.1*(Ns - 301)*np.exp(-D/D0) # Eq 6.8

def H00(rVec, eta):
    # Original name: h0f
    '''Used by H0() in support of frequency gain calculations for troposperic
    scatter.

    Inputs:
      rVec (float[2]) : vector of [r1, r2] in Eq 6.10.
      eta (float) : eta_s in Eq 6.10.
    '''

    eta = min(5, eta) # Text under Eq 6.13.
    etaInt = int(eta)
    etaInt = max(0, etaInt) # XXX Necessary? Fig 9.2 TN101v1, eta >= 0.

    if etaInt == 0:
        v =  (1 + np.sqrt(2)/rVec[0])**2 # 1st factor of 6.14.
        v *= (1 + np.sqrt(2)/rVec[1])**2 # 2nd factor of 6.14.
        v *= (rVec[0] + rVec[1])/(rVec[0] + rVec[1] + 2*np.sqrt(2)) # Eq 6.14
        h00Lo = 10*np.log10(v)           # Eq 6.14
    else:
        h01 = H01(rVec, etaInt)
        h00Lo = (h01[0] + h01[1])/2      # Eq 6.12 for j.

    etaFrac = eta - etaInt # Fraction of eta.
    if etaFrac == 0 or etaInt == 5:
        return h00Lo

    # eta non-int, interpolate between values, see below 6.11.
    h01 = H01(rVec, etaInt+1)
    h00Hi = 1/2*(h01[0] + h01[1])        # Eq 6.12 for j+1.
    return (1 - etaFrac)*h00Lo + etaFrac*h00Hi

def H01(r, j):
    '''Used by H00() in support of frequency gain calculations for troposperic
    scatter.

    Inputs:
      j (int): 1 to 5.
    '''

    j -= 1 # Adjust index into arrays of coefficients.
    a = np.array([25, 80, 177, 395, 705]) # **-4 coefficient.
    b = np.array([24, 45,  68,  80, 105]) # **-2 coefficient.
    return 10*np.log10(1 + b[j]/r**2 + a[j]/r**4)   # Eq 6.13

def horizons(dist, pfl, gammaE, hg):
    # Original name hzns
    '''Here we use the terrain profile pfl to find the two horizons. Output
    consists of the horizon distances dl and the horizon take-off angles
    the. If the path is line-of-sight, the routine sets both horizon
    distances equal to dist.  See Fig 6.1 in following reference:

    Variable names are mostly as presented in "Transmission Loss Predictions
    for Tropospheric Communication Circuits," 1967, vols 1 and 2, by Rice,
    Longley, Norton and Barsis.

    Inputs:
      dist (float[]): meters, distances to terrain points.
      pfl (float[]): terrain profile, elevations above sea level.
      gammaE (float): Earth's effective curvature.
      hg = prop['hg'] # Antenna structure heights.

    Outputs
      (float[2]): Horizon distances.
      (float[2]): Horizon elevation angles.
    '''

    n = pfl.size
    a = 1/gammaE                          # Effective radius of earth.

    hts = pfl[0] + hg[0]                  # Tx antenna hgt above sea level.
    hLt = pfl[1:n-1]                      # Skip tx/rx antenna locations.
    dLt = dist[1:n-1]                     # Distances of hLt elevations.
    thetaEt = (hLt - hts)/dLt - dLt/(2*a) # TN101v1 Eq 6.15, tx side.
    thetaTx = np.max(thetaEt)             # Min diffraction or scatter angle.
    i = np.where(thetaEt==thetaTx)[0][0]  # 1st occurence of max angle.
    rangeTx = dist[i+1]                   # Dist from tx ant at max angle.

    hrs = pfl[-1] + hg[-1]                # Rx antenna hgt above sea level.
    hLr = hLt[::-1]                       # Flip profile direction for rx.
    dLr = dLt                             # Just to match published eqn.
    thetaEr = (hLr - hrs)/dLr - dLr/(2*a) # Eq 6.15, rx side.
    thetaRx = np.max(thetaEr)             # Find max angle, rx side.
    i = np.where(thetaEr==thetaRx)[0][0]  # 1st occurence of max angle.
    rangeRx = dist[i+1]                   # Dist from rx at angle.

    return [np.array([rangeTx, rangeRx]), np.array([thetaTx, thetaRx])]

def interdecileRange_m(deltaH_m, dist_m):
    '''From "Prediction of Tropospheric Radio Transmission Loss Over
    Irregular Terrain, A Computer Method-1968," Equation 3.  From that
    paper, "The interdecile range, Delta_h(d), of terrain heights above
    and below a straight line fitted to elevations above sea level, is
    calculated at fixed distances.  Usually median values of Delta_h(d)
    an asymptotic value, Delta_h, is calculated at fixed increase with
    path length to which is used to characterize the terrain.

    Inputs:
      deltaH_m (float): The asymptotic value of this function.  This value 
        characterizes the terrain.
      dist_m (float): desired distance to calculate Delta_h(dist_m).
    Output:
      (float): Delta_h(d), the interdecile range of terrain heights at
        dist_m meters moving toward asymptotic input value deltaH_m.
    '''

    D = 50e3 # meters
    return (1 - 0.8*np.exp(-dist_m/D))*deltaH_m # Eq 3.9, Delta_h(d).

def knife(v):
    # Original name: aknfe
    '''Calculate diffraction for an ideal knife edge, rho=0, in Annex
    III of TN101v2.

    The attenuation due to a single knife edge.  The expressions below
    approximate the theoretical curve in Figure 7.1 in TN101v1 from about
    -0.8 onward and do not fit the ripple.  The approximation is that given
    in Eq 6.1 and Annex III.24.
    '''

    if v < 2.4: # I.8 says, 0 < v <= 2.4
        a = 6.02 + 9.11*v - 1.27*v**2 # Eq I.8 TN101v2
    else:
        a = 12.953 + 20*np.log10(v)   # Eq I.8 or Eq 7.2 TN101
    return a # in dB.

def leastSqr(x, y, x0, x1, yVals=True):
    '''Hufford's original linear least squares subroutine, zlsq1(), was
    optimized for regularly spaced elevation points.  When that is the
    case, x-axis data, normalizing distance between points to 1 always
    yields the sequence 0,1,2...,n.  The subroutine below is not optimized
    for regular x-axis data and implements the standard definition of linear
    least squares.  The advantage is that irregularly spaced elevation
    data can be supported.

    This subroutine is a little more than only a linear fit.  The
    Longley-Rice model at times requires a linear fit to only terrain
    points visible from both antennas.  Parameters x0 and x1 are the
    distances from station 1 delineating the commonly visible terrain.
    However, the return values are the heights from the fit corresponding
    to the first and last points of the terrain array.  That is, if the
    fit is f(d), return values are endpoints f(0) and f(y.size-1) and not
    the subrange f(x0), f(x1).

    Inputs:
      x (float or float[]): meters, increasing distances for each
        y[] terrain point.
      y (float[]): meters, array of terrain elevations above sea level.
      x0 (float): leftmost endpoint to begin linear fit.
      x1 (float): rightmost endpoint to end linear fit.
    Outputs:
      z0 (float): f(0), where f is the linear fit.
      zn (float): f(y.size-1), where f is the linear fit.
    '''

    # Preparatory work. Find terrain x[] indices, i0,i1 of x0,x1.
    nTot = y.size
    i0 = np.searchsorted(x, x0)
    i1 = np.searchsorted(x, x1)
    if i1 == i0: # x0,x1 very close to each other.
        i0 = max(0, i0-1)
        i1 = min(nTot, i1)
    # End prep work.  Now y[i0:i1] is subrange to perform fit.

    # Begin least squares.
    X = x[i0:i1+1].mean()
    Y = y[i0:i1+1].mean()
    m = ((x[i0:i1+1] - X)*(y[i0:i1+1] - Y)).sum() # Numerator.
    m /= ((x[i0:i1+1] - X)**2).sum()              # Denominator.
    b = Y - m*X
    # End least squares.

    if not yVals: # Return slope, y-intercept, subrange indices.
        return m, b, i0, i1

    # Calculate and return f(x0) and f(x1), from linear least squares fit f().
    y0 = m*x[ 0] + b # f(0), not f(x0).
    yn = m*x[-1] + b # f(d), not f(x1).
    return y0, yn # Return values at terrain end-points.

def lrArea(site, climate=None, mdVar=None):
    # Original qlra == Longley Rice Area.
    '''This is used to prepare the model in the area prediction
    mode. Normally, one first calls lrPrep and then lrArea. Before calling
    the latter, one should have defined in the h "Primary parameters 2"
    the antenna heights hg, the terrain irregularity parameter dh,
    and (probably through lrPrep) the variables wn, ens, gme, and
    zgnd. The input site will define siting criteria for the terminals.

    Siting criteria: Criteria describing the care taken at each
    terminal to assure good radio propagation conditions. This is
    expressed qualitatively in three steps: at random, with care,
    and with great care.

    Inputs:
      site (char[]): station siting, r(andom), c(areful), v(ery careful).
      climate (int): new climate index.
      mdvar (int): new index mode of variability.
    Outputs:
      none, but modifies prop values: dl, he, the.
    '''

    global prop, propv # Dictionaries described in file header comments.

    # Inputs
    deltaH  = prop['dh']  # Terrain irregularity parameter
    gammaE  = prop['gme'] # Earth's effective curvature.
    hg      = prop['hg']  # Antenna structural heights.
    # Outputs (arrays modified)
    dLj     = prop['dl']  # Rough earth horizons.
    he      = prop['he']  # Effective antenna heights in m.
    thetaEj = prop['the'] # Rough earth horizon elevation angles.

    for j in range(2):
        if site[j] == 'r':     # Terminal j is sited at random.
            he[j] = hg[j]      # Eq 3.1
        else:
            if site[j] == 'c': # Terminal sited carefully.
                Bj = 5         # m, Eq 3.1
            else:              # 'v', terminal sited very carefully.
                Bj = 10        # m, Eq 3.1
            H1 = 1             # m, Eq 3.2
            H2 = 5             # m, Eq 3.2
            Bjp = (Bj - H1) * np.sin(np.pi/2 * min(hg[j]/H2, 1)) + H1
            # max() not in GH12, but avoids div by 0 with smooth earth.
            he[j] = hg[j] + Bjp*np.exp(-2*hg[j] / max(1e-3, deltaH))

        dLsj = np.sqrt(2*he[j]/gammaE) # Eq 3.5, smooth earth horizons.
        H3 = 5                         # m, Eq 3.3
        dLj[j] = dLsj * np.exp(-0.07 * np.sqrt(deltaH/max(he[j], H3))) # Eq 3.3
        thetaEj[j] = (0.65*deltaH*(dLsj/dLj[j] - 1) - 2*he[j]) / dLsj  # Eq 3.4
    prop['mdp'] = 1 # Area mode, beginning.

    # Indicate only which items need recalculating in aVar().
    avarRecalc(lFreq) # Tell aVar() that frequency changed.
    if not mdVar is None:
        mdvarSet(mdVar)
    if not climate is None:
        propv['klim'] = climate
        avarRecalc(lClim) # Tell aVar() that climate changed.

def lrPrep(f_MHz, zs, N0, pol, epsR, sigma):
    # Original name: qlrps == Longley Rice prediction setup??
    '''This subroutine converts the frequency f_MHz, the surface
    refractivity reduced to sea level N0 and general system elevation
    zs, and the polarization and ground constants epsR, sigma, to wave
    number wn, surface refractivity ens, effective earth curvature
    gme, and surface impedance Zg. It may be used with either the
    area prediction or the point-to-point mode.

    Inputs:
      f_MHz (float): frequency of wave, MHz.
      zs (float): system elevation above sea level, m.
      N0 (float): sea level refractivity.
      pol (string): polarization, 'h' horizontal or 'v' vertical.
      epsR (float): relative ground permittivity, F/m.
      sigma (float): relative ground conductivity, S.

    Outputs:
      No function output, but prop dictionary keys updated are:
        wn (float): wave number.
        Ns (float): surface refractivity, N-units.
        gammaE (float): effective earth curvature.
        Zg (complex): unitless ratio, modified surface impedance due to
          antenna polarization.
    '''

    global prop

    wn = f_MHz/f0                   # Eq 1.1
    z1 = 9460                       # m, Eq 1.2
    Ns = N0*np.exp(-zs/z1)          # Eq 1.2, TN101v1, Eq 4.3.

    gammaA = 1/rEarth_m             # == 157 N-units/km.
    N1 = 179.31                     # N-units, Eq 1.3.  1/0.005577
    gammaE = gammaA*(1 - 0.04665*np.exp(Ns/N1)) # Eq 1.3, TN101v1, Eq 4.4.

    mu0 = 1.2566370621219e-6        # Vacuum permeability, N/(A^2).
    mu = 1                          # Air
    eps0 = 8.854187812813e-12       # Vacuum permittivity, F/m.
    eps = 1.0006                    # Air
    Z0 = np.sqrt(mu0*mu/(eps0*eps)) # ~376.62 ohms.
    epsRp = epsR + 1j*Z0*sigma/wn   # F/m, Eq 1.5, relative permittivity.

    if pol.lower() == 'h':          # Horizontal polarization.
        Zg = np.sqrt(epsRp-1)       # Eq 1.4
    else: # 'v'                     # Vertical polarization.
        Zg = np.sqrt(epsRp-1)/epsRp # Eq 1.4

    prop['ens'] = Ns       # Surface refractivity in N-units (parts/million).
    prop['f_MHz'] = f_MHz  # Transmit carrier frequency.
    prop['gme'] = gammaE   # Effective earth curvature within 1 km of surface.
    prop['wn'] = wn        # Wave number.
    prop['zgnd'] = Zg      # Surface impedance due to antenna polarization.

def lrProp(d=0):
    '''Longley-Rice Propagation.

    Inputs:
      d (float) : distance from transmitter, km. Only used in Area mode.

    Returns prop['aref'], the reference attenuation.
    '''

    global prop, propa

    # Inputs, primary parameters.
    dist     = prop['dist']  # Distance between terminals,
    deltaH   = prop['dh']    # Terrain irregularity parameter
    dLj      = prop['dl']    # Horizon distances.
    Ns       = prop['ens']   # Surface refractivity, N-units.
    gammaE   = prop['gme']   # Earth's effective curvature.
    he       = prop['he']    # Antenna effective heights.
    hg       = prop['hg']    # Antenna structural heights.
    modeProp = prop['mdp']   # Mode of propagation: -1 point-to-point,
                             # 1 area mode beginning, 0 area mode continuing.
    thetaEj  = prop['the']   # Rough earth horizon elevation angles.
    wn       = prop['wn']    # Wave number, k in many equations.
    Zg       = prop['zgnd']  # surface transfer impedance of the ground.

    # Sec. 5 in itm.pdf.
    # Sec 3.2 Preparatory calculations for both modes.
    dLsj = np.sqrt(2*he/gammaE) # Eq 3.5, smooth earth horizons.
    dLs = dLsj[0] + dLsj[1]     # Eq 3.6, sum of smooth earth horizons.
    dL = dLj[0] + dLj[1]        # Eq 3.7
    thetaE = max(thetaEj[0]+thetaEj[1], -dL*gammaE) # Eq 3.8
    dx = 0 # Scatter cross-over distance.

    propa['dla'] = dL     # Sum of both rough earth horizon distances.
    propa['dls'] = dLsj   # The two smooth earth radio horizon distances.
    propa['dlsa'] = dLs   # Sum of smooth earth radio horizon distances.
    propa['tha'] = thetaE # Sum of both rough earth elevation angles.
    checkRange()          # Update propv['err'] in case errors occurred.

    # The diffraction region. Diffraction coefficients.
    Xae = (wn * gammaE**2)**(-1/3) # Eq 4.2
    # Xaep from Jan 2023 discussion with ITS on origin of 0.3 factor.
    Xaep = 0.25*(2*np.pi/c_mps)**(1/3)*1e3*Xae # Eq 3.44b, LR68, from km to m.
    d3 = max(dLs, 1.3787*Xae + dL) # Eq 4.3, d3 is beyond LOS.
    d4 = d3 + 2.7574*Xae           # Eq 4.4, d4 is beyond LOS.
    A3 = attenDiff(d3)             # Eq 4.5
    A4 = attenDiff(d4)             # Eq 4.6
    md = (A4 - A3)/(d4 - d3)       # Eq 4.7, scatter mode slope.
    Aed = A3 - md*d3               # Eq 4.8

    if modeProp == 1: # Area mode.
        prop['dist'] = dist = d # Param d used only in area mode, not pt-to-pt.
        avarRecalc(lDist)       # Tell aVar() that distance changed.

    # Check distance, itm.pdf sec. 8.
    if dist > 0:
        checkDist() # Update propv['err'] in case errors occurred.
    if dist < dLs: # Troposcatter calculations, itm.pdf sec. 20.
        d2 = dLs
        A2 = Aed + d2*md
        d0 = 1.908*wn * he[0]*he[1]             # Eq 4.38
        if Aed >= 0:
            d0 = min(d0, dL/2)                  # Eq 4.28
            d1 = d0 + (dL - d0)/4               # Eq 4.29
        else:                                   # Eq 4.39
            d1 = max(-Aed / md, dL/4)
        A1 = attenLos(d1, Aed, md)              # Eq 4.31
        wq = False
        if d0 < d1:
            A0 = attenLos(d0, Aed, md)          # Eq 4.30
            q = np.log(d2/d0)                   # Eq 4.35, denominator.
            K2 = max(0, ((d2 - d0)*(A1 - A0) - (d1 - d0)*(A2 - A0))
                    / ((d2 - d0)*np.log(d1/d0) - (d1 - d0)*q))  # Eq 4.32
            wq = Aed >= 0 or K2 > 0
            if wq:
                K1 = (A2 - A0 - K2*q)/(d2 - d0) # Eq 4.33
                if K1 < 0:
                    K1 = 0                      # Eq 4.36
                    K2 = max(0, A2 - A0)/q      # Eq 4.35
                    if K2 == 0:                 # Eq 4.37
                        K1 = md
        if not wq:
            K1 = max(0, A2 - A1)/(d2 - d1)      # Eq 4.40
            K2 = 0                              # Eq 4.41
            if K1 == 0:
                K1 = md                         # Eq 4.37
        # Line-of-sight coefficient, eq 4.42.
        Ael = A2 - K1*d2 - K2*np.log(d2)        # Eq 4.42

        if dist > 0:
            Aref = (Ael + K1*dist + K2*np.log(dist)) # Eq 4.1
    # Troposcatter calculations, sec. 20.
    if not (0 < dist < dLs):
        Ds = 200e3                              # m, 4.53
        d5 = dL + Ds                            # Eq 4.52
        d6 = d5 + Ds                            # Eq 4.53
        A6, h0s = attenScatter(d6)              # Eq 4.54
        A5, _ = attenScatter(d5, h0s)           # Eq 4.55
        if A5 != np.inf:
            ms = (A6 - A5)/Ds                   # Eq 4.57, scatter slope.
            # ITS emails that dL+0.3Xae line is correct, an unpublished change.
            dx = np.max([dLs,
#               dL + 0.3*Xae*np.log(f0*wn),     # from Fortran, correct.
                dL + Xaep*np.log10(f0*wn),      # GH12, from Jan 2023 NTIA.
                (A5 - Aed - ms*d5)/(md - ms)])  # Eq 4.58
            Aes = ((md - ms)*dx + Aed)          # Eq 4.59
        else:
            ms = md # Scatter slope = diffraction slope.
            Aes = Aed # Extended scatter atten = diffraction atten.
            dx = np.inf                         # Eq 4.56
        # Outputs, secondary parameters.
        if dist > dx:
            Aref = Aes + ms*dist
        else:
            Aref = Aed + md*dist                # Eq 4.1

    # Outputs, primary parameters.
    prop['aref'] = max(Aref, 0) # Reference attenuation in dB.
    propa['dx'] = dx # Scatter cross-over distance.

def lrProfile(rng, pfl, climate=None, mdVar=None):
    # Original name qlrpfl == Longley Rice profile.
    '''This subroutine may be used to prepare for the point-to-point
    mode. Since the path is fixed, it has only one value of aref and
    therefore at the end of the routine there is a call to lrProp. To
    complete the process one needs to call aVar for whatever quantiles
    are desired.

    This mode requires the terrain profile lying between the
    terminals. This should be a sequence of surface elevations at points
    along the great circle path joining the two points. It should start
    at the ground beneath the first terminal and end at the ground
    beneath the second.

    Inputs:
      dist (float[]): meters, distances to terrain points.
      pfl (float[]): terrain profile, elevations above sea level.
      climate (int): updated value for climate.  Only used if it
        changed from precious call to lrProfile().
      mdvar (int): updated value for mode of variability.  Only used
        if it changed from precious call to lrProfile().
    Output:
      Dictionary updates. prop: aref, dh, dist, dl, he, mdp and the;
        propa: dx.
    '''
    global prop, propa, propv

    gammaE = prop['gme']      # Earth's effective curvature
    hg = np.array(prop['hg']) # Antenna structure heights.

    n = pfl.size-1 # Number of intervals (1 less than number of points).
    dist = rng[-1] # Length of profile.

    # Find tx and rx horizons.
    dLj, thetaE = horizons(rng, pfl, gammaE, hg) # Distances, elev angles.
    xl = np.minimum(15*hg, 0.1*dLj) # 1x2, terrain 1st (0.1) decile.
    xl[1] = dist - xl[1] # 9th decile (0.9).
    deltaH = calcDeltaH(rng, pfl, xl[0], xl[1]) # Use middle 80% of terrain.
    he = np.zeros(2) # Room to calculate effective antenna heights.
    if dLj[0] + dLj[1] > 1.5*dist:
        # Redo line-of-sight horizons, itm.pdf sec 45.  Even for line-of-sight,
        # model requires horizon distances and elevation angles.
        # So we use techniques of area prediction mode.
        za, zb = leastSqr(rng, pfl, xl[0], xl[1])
        he[0] = hg[0] + max(0, pfl[0]-za)
        he[1] = hg[1] + max(0, pfl[-1]-zb)
        # Eq 3.3, 1x2 vector
        H3 = 5 # m, Eq 3.3
        dLj = (np.sqrt(2*he/gammaE)
            * np.exp(-0.07*np.sqrt(deltaH/np.maximum(he, H3))))
        if dLj[0] + dLj[1] <= dist:
            he *= (dist/(dLj[0] + dLj[1]))**2 # 1x2 vector
            dLj = (np.sqrt(2*he/gammaE)
                * np.exp(-0.07*np.sqrt(deltaH/np.maximum(he, H3)))) # 1x2 vec.
        dLsj = np.sqrt(2*he/gammaE) # Eq 3.5, smooth earth horizons.
        thetaE = (0.65*deltaH*(dLsj/dLj - 1) - 2*he)/dLsj # Eq 3.4, horiz angle.
    else:
        # Transhorizon effective heights, itm.pdf sec 46.
        za, _ = leastSqr(rng, pfl, xl[0], 0.9*dLj[0])
        _, zb = leastSqr(rng, pfl, dist-0.9*dLj[1], xl[1])
        he[0] = hg[0] + max(0, pfl[0]-za)
        he[1] = hg[1] + max(0, pfl[-1]-zb)

    # Save output values.
    prop['dh']   = deltaH
    prop['dist'] = dist
    prop['dl']   = dLj
    prop['he']   = he
    prop['mdp']  = -1 # Point-to-point mode.
    prop['the']  = thetaE # Rough earth horizon elevation angles.

    # Indicate items that need recalculating in aVar().
    avarRecalc(lFreq) # Tell aVar() that frequency changed.
    if not mdVar is None:
        mdvarSet(mdVar)
    if not climate is None:
        propv['klim'] = climate
        avarRecalc(lClim) # Tell aVar() that climate changed.
    lrProp()

def lvarGet(level):
    '''Return True/False if passed level is currently set/unset.
    '''
    global propv
    return (propv['lvar'] & level) != 0

def mdvarGet(mode):
    '''Return True/False if passed mode is currently set/unset.
    One of the following four will be set:
      mSingle   Single message mode.
      mRandom   Individual/Accidental mode.
      mMobile   Mobile mode.
      mBcast    Broadcast mode.

    In addition, zero, one or both of the following might be set.
      mPfl      Point-to-point mode.
      mIfere    Interference problems (affects aVar statistics calculations).
    '''
    global propv
    return (propv['mdvar'] & mode) != 0

def mdvarSet(mode):
    '''The mdvar variable holds two types of data, transmission mode and
    problem type.  It might be wiser to have two variables, but this is
    patterned after the original fortran.  Exactly one of the following can
    be set:
      mSingle   Single message mode.
      mRandom   Individual/Accidental mode.
      mMobile   Mobile mode.
      mBcast    Broadcast mode.
    In addition, zero, one or both of the following can be set.
      mPfl      Point-to-point mode.
      mIfere    Interference problems (affects aVar statistics calculations).

    Input:
      mode (int): one of the above 6 values or mClear to clear the mdvar
        variable.
    '''
    global propv
    if mode == mClear:
        propv['mdvar'] = 0
    elif mode <= 8:
        propv['mdvar'] &= 0xf0 # Clear 4 least significant bits.
    propv['mdvar'] |= mode     # Set mode bit.
    avarRecalc(lMode)          # Tell aVar() that mdvar has changed.

def mdvarUnset(mode):
    '''Clear a particular bit in the mdvar as described in mdvarSet().  This
    is especially helpful to turn on/off mIfere for interference studies.
    '''
    global propv
    propv['mdvar'] &= ~mode
    avarRecalc(lMode)

def propMode(pfl):
    '''After a call to lrProp() it is often helpful knowing which mode of
    propagation was dominant in the calculation.  Based on the terrain
    profile and various distances calculated, a two part response is
    generated.

    Input:
      pfl (float[]): terrain profile that ws used by lrProp().
    Output:
      (string[2]):
        First character is one of:
          l: line of sight
          s: single horizon
          d: double horizon
        Second character (if used):
          d: diffraction
          t: tropospheric scatter
    '''
    global prop, propa

    dist_m   = prop['dist']  # Distance between terminals,
    dL_m     = propa['dla']  # Sum of two rough earth horizon distances.
    dLs_m    = propa['dlsa'] # Sum of two smooth earth horizon distances.
    dx_m     = propa['dx']   # Scatter cross-over distance.
    deltaD = dist_m - dL_m
    L = (pfl[-1] - pfl[0])/(pfl.size - 1)
    v = max(0, deltaD-L/2) - max(0, -deltaD-L/2)
    res2 = ''
    if v < 0:
        res1 = 'l' # Line of sight.
    else:
        if v == 0:
            res1 = 's' # Single horizon.
        else: # v>0
            res1 = 'd' # Double horizon.
        if dist_m < dLs_m:
            res2 = 'd' # Diffraction.
        elif dist_m <= dx_m:
            res2 = 't' # Tropospheric scatter.
    return res1, res2

def roughness_m(deltaHs_m):
    '''From "Prediction of Tropospheric Radio Transmission Loss Over
    Irregular Terrain, A Computer Method-1968," Equations 3.6a,b:  From that
    The terrain roughness factor for line-of-sight calculations represents
    the rms deviation of terrain and terrain clutter within the limits of
    the first Fresnel zone in the dominant reflecting plane.

    These formulas define the points at which the first Fresnel ellipse cuts
    the great circle plane.  The factor sigma_h was then calculated as the
    rms deviation of modified terrain elevations relative to a smooth curve
    within these limits.

    Input:
      deltaHs_m (float): the precalculated interdecile range of terrain
        heights at some distance.
    Output:
      (float): terrain roughness factor in meters, sigma_h. 
    '''
    if deltaHs_m > 4:
        H = 16.0
        return 0.78*deltaHs_m * np.exp(-(deltaHs_m/H)**0.25) # Eq 3.6a.
    else:
        return 0.39*deltaHs_m  # Eq 3.6b.
