import type { Vehicle } from "@/lib/types";

export function VehicleDetailsFields({ vehicle }: { vehicle?: Vehicle }) {
  return (
    <>
      <div className="formGrid">
        <label className="fieldLabel">Make<input defaultValue={vehicle?.make ?? ""} name="make" placeholder="GWM" /></label>
        <label className="fieldLabel">Model year<input defaultValue={vehicle?.model_year ?? ""} min="1900" max="2100" name="modelYear" type="number" /></label>
        <label className="fieldLabel">Vehicle type<select defaultValue={vehicle?.vehicle_type ?? ""} name="vehicleType"><option value="">Not set</option><option value="sedan">Sedan</option><option value="suv">SUV</option><option value="ute">Ute</option><option value="truck">Truck</option><option value="display">Display vehicle</option><option value="other">Other</option></select></label>
        <label className="fieldLabel">Department<input defaultValue={vehicle?.department ?? ""} name="department" placeholder="Free text until departments are fixed" /></label>
        <label className="fieldLabel">Fuel type<select defaultValue={vehicle?.fuel_type ?? ""} name="fuelType"><option value="">Not set</option><option value="petrol">Petrol</option><option value="diesel">Diesel</option><option value="hybrid">Hybrid</option><option value="electric">Electric</option></select></label>
        <label className="fieldLabel">Default parking location<input defaultValue={vehicle?.default_parking_location ?? ""} name="defaultParkingLocation" /></label>
        <label className="fieldLabel">Spare key location<input defaultValue={vehicle?.spare_key_location ?? ""} name="spareKeyLocation" /></label>
        <label className="fieldLabel">Current location<input defaultValue={vehicle?.current_location_name ?? vehicle?.location ?? ""} name="currentLocationName" /></label>
        <label className="fieldLabel">Current location address<input defaultValue={vehicle?.current_location_address ?? ""} name="currentLocationAddress" /></label>
        <label className="fieldLabel">Location source<select defaultValue={vehicle?.location_source ?? ""} name="locationSource"><option value="">Not set</option><option value="manual">Manual update</option><option value="booking">Borrow record</option><option value="gps">GPS</option><option value="admin_confirmed">Admin confirmed</option></select></label>
        <label className="fieldLabel">Custodian<input defaultValue={vehicle?.current_custodian_name ?? ""} name="currentCustodianName" placeholder="Person or team responsible" /></label>
        <label className="fieldLabel">Current key holder<input defaultValue={vehicle?.current_key_holder_name ?? ""} name="currentKeyHolderName" /></label>
        <label className="fieldLabel">Expected return / arrival<input defaultValue={vehicle?.expected_return_or_arrival_at?.slice(0, 16) ?? ""} name="expectedReturnOrArrivalAt" type="datetime-local" /></label>
      </div>
      <label className="fieldLabel">Location notes<textarea defaultValue={vehicle?.location_comments ?? ""} name="locationComments" /></label>
      <h3>Registration, insurance and compliance</h3>
      <div className="formGrid">
        <label className="fieldLabel">Registration state<input defaultValue={vehicle?.registration_state ?? ""} name="registrationState" placeholder="NSW" /></label>
        <label className="fieldLabel">Registration expiry<input defaultValue={vehicle?.registration_expires_on ?? ""} name="registrationExpiresOn" type="date" /></label>
        <label className="fieldLabel">Insurer<input defaultValue={vehicle?.insurer ?? ""} name="insurer" /></label>
        <label className="fieldLabel">Policy number<input defaultValue={vehicle?.insurance_policy_number ?? ""} name="insurancePolicyNumber" /></label>
        <label className="fieldLabel">Insurance expiry<input defaultValue={vehicle?.insurance_expires_on ?? ""} name="insuranceExpiresOn" type="date" /></label>
        <label className="fieldLabel">Inspection expiry<input defaultValue={vehicle?.inspection_expires_on ?? ""} name="inspectionExpiresOn" type="date" /></label>
        <label className="fieldLabel">Reminder days<input defaultValue={vehicle?.reminder_days ?? 30} min="0" max="365" name="reminderDays" type="number" /></label>
      </div>
      <label className="fieldLabel">Usage restrictions<textarea defaultValue={vehicle?.usage_restrictions ?? ""} name="usageRestrictions" /></label>
    </>
  );
}
