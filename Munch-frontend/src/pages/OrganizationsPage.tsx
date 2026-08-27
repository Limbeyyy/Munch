import React, { useEffect, useState } from 'react';
import { useOrganizationStore } from '../store/organizationStore';
import { Organization } from '../types';

export const OrganizationsPage: React.FC = () => {
  const {
    organizations,
    currentOrganization,
    loading,
    error,
    setCurrentOrganization,
  } = useOrganizationStore();

  const [showNewOrgForm, setShowNewOrgForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', slug: '' });

  useEffect(() => {
    // Fetch organizations on mount
  }, []);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Call API to create organization
  };

  const handleSelectOrg = (org: Organization) => {
    setCurrentOrganization(org);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Organizations</h1>
          <button
            onClick={() => setShowNewOrgForm(!showNewOrgForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Create Organization
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {showNewOrgForm && (
          <form
            onSubmit={handleCreateOrg}
            className="bg-white rounded-lg shadow p-6 mb-8"
          >
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Organization Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Slug
              </label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) =>
                  setFormData({ ...formData, slug: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {organizations.map((org) => (
            <div
              key={org.id}
              onClick={() => handleSelectOrg(org)}
              className={`bg-white rounded-lg shadow p-6 cursor-pointer hover:shadow-lg transition ${
                currentOrganization?.id === org.id
                  ? 'ring-2 ring-blue-500'
                  : ''
              }`}
            >
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {org.name}
              </h3>
              <p className="text-gray-500 text-sm mb-4">
                Slug: <code className="bg-gray-100 px-2 py-1">{org.slug}</code>
              </p>
              <p className="text-sm text-gray-600">
                Status: {org.is_active ? '✓ Active' : 'Inactive'}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Created: {new Date(org.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
