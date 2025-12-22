import React, { useState, useEffect } from 'react';

interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  restaurant: string;
  permissions: string[];
}

const GratlyProfilePage: React.FC = () => {
  const [logoData, setLogoData] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [profile, setProfile] = useState<UserProfile>({
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@restaurant.com',
    phoneNumber: '+1 (555) 123-4567',
    restaurant: 'The Grand Restaurant',
    permissions: ['View Reports', 'Manage Tips', 'Edit Forms', 'View Dashboard']
  });

  const [editedProfile, setEditedProfile] = useState<UserProfile>(profile);

  const allPermissions = [
    'View Dashboard',
    'View Reports',
    'Manage Tips',
    'Edit Forms',
    'Manage Employees',
    'Process Payouts',
    'Admin Access'
  ];

  useEffect(() => {
    const loadLogo = async (): Promise<void> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await (window as any).fs.readFile('image.png');
        const blob = new Blob([data], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        setLogoData(url);
      } catch (error) {
        console.error('Error loading logo:', error);
      }
    };
    loadLogo();
  }, []);

  const handleEdit = () => {
    setIsEditing(true);
    setEditedProfile(profile);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedProfile(profile);
  };

  const handleSave = () => {
    setProfile(editedProfile);
    setIsEditing(false);
    console.log('Profile updated:', editedProfile);
    alert('Profile updated successfully!');
  };

  const togglePermission = (permission: string) => {
    if (editedProfile.permissions.includes(permission)) {
      setEditedProfile({
        ...editedProfile,
        permissions: editedProfile.permissions.filter(p => p !== permission)
      });
    } else {
      setEditedProfile({
        ...editedProfile,
        permissions: [...editedProfile.permissions, permission]
      });
    }
  };

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#f4f2ee' }}>
      {/* Main Content */}
      <div className="max-w-4xl mx-auto p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Profile Settings</h1>
          <p className="text-gray-600 mt-2">Manage your account information and permissions</p>
        </div>

        <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
          {/* Profile Header */}
          <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-8 py-12 text-center">
            <div className="w-24 h-24 bg-white rounded-full mx-auto flex items-center justify-center mb-4 shadow-lg">
              <span className="text-4xl font-bold text-gray-900">
                {profile.firstName[0]}{profile.lastName[0]}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-white">
              {profile.firstName} {profile.lastName}
            </h2>
            <p className="text-gray-300 mt-1">{profile.restaurant}</p>
          </div>

          {/* Profile Content */}
          <div className="p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">Personal Information</h3>
              {!isEditing ? (
                <button
                  onClick={handleEdit}
                  className="bg-gray-900 text-white px-6 py-2 rounded-lg font-semibold hover:bg-gray-800 transition-all shadow-md"
                >
                  Edit Profile
                </button>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={handleCancel}
                    className="bg-white text-gray-900 px-6 py-2 rounded-lg font-semibold border-2 border-gray-300 hover:bg-gray-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="bg-gray-900 text-white px-6 py-2 rounded-lg font-semibold hover:bg-gray-800 transition-all shadow-md"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </div>

            {/* Form Fields */}
            <div className="space-y-6">
              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    First Name
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.firstName}
                      onChange={(e) => setEditedProfile({ ...editedProfile, firstName: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                    />
                  ) : (
                    <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                      {profile.firstName}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Last Name
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.lastName}
                      onChange={(e) => setEditedProfile({ ...editedProfile, lastName: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                    />
                  ) : (
                    <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                      {profile.lastName}
                    </div>
                  )}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                {isEditing ? (
                  <input
                    type="email"
                    value={editedProfile.email}
                    onChange={(e) => setEditedProfile({ ...editedProfile, email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                  />
                ) : (
                  <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                    {profile.email}
                  </div>
                )}
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                {isEditing ? (
                  <input
                    type="tel"
                    value={editedProfile.phoneNumber}
                    onChange={(e) => setEditedProfile({ ...editedProfile, phoneNumber: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                  />
                ) : (
                  <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                    {profile.phoneNumber}
                  </div>
                )}
              </div>

              {/* Restaurant */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Restaurant
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedProfile.restaurant}
                    onChange={(e) => setEditedProfile({ ...editedProfile, restaurant: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                  />
                ) : (
                  <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                    {profile.restaurant}
                  </div>
                )}
              </div>

              {/* Permissions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Permissions
                </label>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="grid grid-cols-2 gap-3">
                    {allPermissions.map((permission) => (
                      <label
                        key={permission}
                        className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                          isEditing ? 'cursor-pointer hover:bg-white' : 'cursor-default'
                        } ${
                          editedProfile.permissions.includes(permission)
                            ? 'bg-white border-2 border-gray-900'
                            : 'bg-gray-100 border-2 border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={editedProfile.permissions.includes(permission)}
                          onChange={() => isEditing && togglePermission(permission)}
                          disabled={!isEditing}
                          className="w-5 h-5 rounded"
                        />
                        <span className={`text-sm font-medium ${
                          editedProfile.permissions.includes(permission)
                            ? 'text-gray-900'
                            : 'text-gray-600'
                        }`}>
                          {permission}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Info Card */}
        <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mt-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Account Security</h3>
          <div className="space-y-3">
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-between">
              <span className="font-medium text-gray-900">Change Password</span>
              <span className="text-gray-400">→</span>
            </button>
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-between">
              <span className="font-medium text-gray-900">Two-Factor Authentication</span>
              <span className="text-green-600 text-sm font-semibold">Enabled</span>
            </button>
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-between">
              <span className="font-medium text-gray-900">Session History</span>
              <span className="text-gray-400">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GratlyProfilePage;
